import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { SUMMARY_STALE_MS, type ReferralDoc, type ReferralSummary } from '../../shared/contracts';
import type { QSummaryContent } from '../../shared/types';
import { qSummaryContentSchema } from '../../shared/schemas';
import { db } from '../../lib/firebase';
import { MESSAGES } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { getPatient, getReferral, listVisits, referralRef } from '../../repositories';
import { buildSummaryContext } from './buildContext';
import { getSummaryProvider } from './provider';

export type RunSummaryResult =
  | { ok: true; content: QSummaryContent; provider: string }
  | { ok: false; error: string; skipped?: boolean; busy?: boolean };

export const SUMMARY_BUSY_MESSAGE = 'The summary is already being generated. Please wait.';

/**
 * Pure: is a summary generation currently in progress (and therefore must not be restarted)?
 * A 'generating' state with a missing startedAt, or older than SUMMARY_STALE_MS, is stale (crashed/timed-out
 * instance) and treated as retryable.
 */
export function isSummaryGenerationActive(summary: Pick<ReferralSummary, 'state' | 'startedAt'>, nowMillis: number): boolean {
  if (summary.state !== 'generating') return false;
  const started = summary.startedAt?.toMillis();
  if (started == null) return false;
  return nowMillis - started < SUMMARY_STALE_MS;
}

/**
 * Generates the AI summary for a referral. Never throws: failures are recorded on the referral
 * (summary.state = 'failed', user-safe error) so the midwife can review the raw chart and retry.
 */
export async function runSummary(referralId: string, now: () => Date = () => new Date()): Promise<RunSummaryResult> {
  const ref = referralRef(referralId);

  // 1. Claim the run (state → generating, attempts++, startedAt = now) in ONE transaction, so concurrent
  //    callers/triggers cannot both start. Never overwrite reviewed content; never preempt a fresh run.
  type Start = { kind: 'started'; referral: ReferralDoc; attempt: number } | { kind: 'missing' } | { kind: 'approved' } | { kind: 'busy' };
  let start: Start;
  try {
    start = await db().runTransaction(async (tx): Promise<Start> => {
      const current = await getReferral(referralId, tx);
      if (!current) return { kind: 'missing' };
      if (current.summary.state === 'approved') return { kind: 'approved' };
      if (isSummaryGenerationActive(current.summary, now().getTime())) return { kind: 'busy' };
      const attempt = (current.summary.attempts ?? 0) + 1;
      const ts = Timestamp.now();
      tx.update(ref, { 'summary.state': 'generating', 'summary.attempts': attempt, 'summary.startedAt': ts, 'summary.error': null, updatedAt: ts });
      return { kind: 'started', referral: current, attempt };
    });
  } catch (err) {
    logger.error('runSummary: could not start', { referralId, message: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: MESSAGES.aiUnavailable };
  }
  if (start.kind === 'missing') return { ok: false, error: MESSAGES.notFound, skipped: true };
  if (start.kind === 'approved') return { ok: false, error: 'Summary already reviewed.', skipped: true };
  if (start.kind === 'busy') return { ok: false, error: SUMMARY_BUSY_MESSAGE, skipped: true, busy: true };
  const { referral, attempt } = start;
  /** Only the run that owns the current attempt may finish it (a stale run that was taken over must not overwrite). */
  const ownsRun = (current: ReferralDoc | null): current is ReferralDoc => !!current && current.summary.state === 'generating' && (current.summary.attempts ?? 0) === attempt;

  const auditBase = {
    actorKind: 'system' as const,
    actorUid: null,
    actorRole: null,
    clinicId: referral.clinicId,
    patientId: referral.patientId,
    referralId,
  };

  let providerName = 'unknown';
  try {
    const patient = await getPatient(referral.patientId);
    if (!patient) throw new Error('Patient record missing');
    const visits = await listVisits(referral.patientId);
    const context = buildSummaryContext(patient, visits, { type: referral.type, reasonText: referral.reason.text || referral.reason.label }, now());
    const provider = getSummaryProvider();
    providerName = provider.name;
    const raw = await provider.generate(context);
    // AI output is untrusted: validate structure and limits before storing.
    const parsed = qSummaryContentSchema.safeParse(raw);
    if (!parsed.success) throw new Error('Provider output failed validation');
    const content = parsed.data;

    const written = await db().runTransaction(async (tx) => {
      const current = await getReferral(referralId, tx);
      if (!ownsRun(current)) return false;
      tx.update(ref, {
        'summary.state': 'ready',
        'summary.provider': providerName,
        'summary.content': content,
        'summary.generatedAt': Timestamp.now(),
        'summary.error': null,
        updatedAt: Timestamp.now(),
      });
      return true;
    });
    if (!written) return { ok: false, error: 'Summary state changed during generation.', skipped: true };
    await writeAudit({ ...auditBase, action: 'summary_generated', details: { provider: providerName, type: referral.type } });
    return { ok: true, content, provider: providerName };
  } catch (err) {
    logger.warn('runSummary: generation failed', { referralId, provider: providerName, message: err instanceof Error ? err.message : String(err) });
    try {
      await db().runTransaction(async (tx) => {
        const current = await getReferral(referralId, tx);
        if (!ownsRun(current)) return;
        tx.update(ref, { 'summary.state': 'failed', 'summary.provider': providerName, 'summary.error': MESSAGES.aiUnavailable, updatedAt: Timestamp.now() });
      });
    } catch (writeErr) {
      logger.error('runSummary: could not record failure', { referralId, message: writeErr instanceof Error ? writeErr.message : String(writeErr) });
    }
    await writeAudit({ ...auditBase, action: 'summary_failed', details: { provider: providerName, type: referral.type } });
    return { ok: false, error: MESSAGES.aiUnavailable };
  }
}
