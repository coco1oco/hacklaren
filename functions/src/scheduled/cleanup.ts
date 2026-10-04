// Hourly maintenance. NEVER deletes patients or visits.
import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/logger';
import { COLLECTIONS, type ReferralDoc, type ReferralTokenDoc, type SmsLogDoc } from '../shared/contracts';
import { canTransition } from '../shared/referralStatus';
import { auditInTx } from '../lib/audit';
import { db } from '../lib/firebase';
import { MESSAGES } from '../lib/errors';
import { getReferral, referralRef } from '../repositories';
import { isSummaryGenerationActive, runSummary } from '../services/summary/runSummary';
import { processReferralRequest } from '../referrals/triggers';
import { getSmsProvider, smsSecrets } from '../services/sms/provider';

const DAY_MS = 86_400_000;
const BATCH = 300;

/** Pure: should a referral be moved to EXPIRED now? (only SENT referrals with an expired link; see state machine) */
export function shouldExpire(r: Pick<ReferralDoc, 'type' | 'status' | 'link'>, nowMillis: number): boolean {
  const expiresAt = r.link?.expiresAt?.toMillis();
  if (expiresAt == null || nowMillis < expiresAt) return false;
  return canTransition(r.type, r.status, 'EXPIRED', 'system').allowed;
}

async function expireReferrals(nowMs: number): Promise<number> {
  // Only SENT referrals whose link has already expired (composite index: status ASC, link.expiresAt ASC),
  // so unexpired docs are never re-read and each run makes progress.
  const snap = await db()
    .collection(COLLECTIONS.referrals)
    .where('status', '==', 'SENT')
    .where('link.expiresAt', '<=', Timestamp.fromMillis(nowMs))
    .orderBy('link.expiresAt', 'asc')
    .limit(BATCH)
    .get();
  let count = 0;
  for (const d of snap.docs) {
    if (!shouldExpire(d.data() as ReferralDoc, nowMs)) continue;
    const expired = await db().runTransaction(async (tx) => {
      const r = await getReferral(d.id, tx);
      if (!r || !shouldExpire(r, Date.now())) return false;
      const now = Timestamp.now();
      tx.update(referralRef(r.referralId), {
        status: 'EXPIRED',
        statusHistory: [...r.statusHistory, { status: 'EXPIRED', at: now, actor: 'system', uid: null, note: null }],
        expiredAt: now,
        updatedAt: now,
      });
      auditInTx(tx, { action: 'referral_expired', actorKind: 'system', actorUid: null, actorRole: null, clinicId: r.clinicId, patientId: r.patientId, referralId: r.referralId, details: { from: r.status } });
      return true;
    });
    if (expired) count++;
  }
  return count;
}

/**
 * Marks summaries stuck in 'generating' (crashed/timed-out instance) as failed with the user-safe message,
 * so the hospital view shows "AI summary unavailable" and the midwife can retry. Single-field equality query, bounded.
 */
async function failStaleSummaries(nowMs: number): Promise<number> {
  const snap = await db().collection(COLLECTIONS.referrals).where('summary.state', '==', 'generating').limit(BATCH).get();
  let count = 0;
  for (const d of snap.docs) {
    if (isSummaryGenerationActive((d.data() as ReferralDoc).summary, nowMs)) continue;
    const failed = await db().runTransaction(async (tx) => {
      const r = await getReferral(d.id, tx);
      if (!r || isSummaryGenerationActive(r.summary, Date.now()) || r.summary.state !== 'generating') return false;
      tx.update(referralRef(r.referralId), { 'summary.state': 'failed', 'summary.error': MESSAGES.aiUnavailable, updatedAt: Timestamp.now() });
      auditInTx(tx, { action: 'summary_failed', actorKind: 'system', actorUid: null, actorRole: null, clinicId: r.clinicId, patientId: r.patientId, referralId: r.referralId, details: { reason: 'stale', type: r.type } });
      return true;
    });
    if (failed) count++;
  }
  return count;
}

async function deleteWhereBefore(collection: string, field: string, before: number): Promise<number> {
  const snap = await db().collection(collection).where(field, '<=', Timestamp.fromMillis(before)).limit(BATCH).get();
  if (snap.empty) return 0;
  const batch = db().batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
}

async function refreshSmsStatuses(): Promise<number> {
  const provider = getSmsProvider();
  if (!provider.fetchStatus) return 0;
  const snap = await db().collection(COLLECTIONS.smsLogs).where('status', '==', 'sent').where('provider', '==', provider.name).limit(100).get();
  let updated = 0;
  for (const d of snap.docs) {
    const log = d.data() as SmsLogDoc;
    if (!log.providerMessageId) continue;
    const res = await provider.fetchStatus(log.providerMessageId);
    if (res.status === 'delivered') {
      await d.ref.update({ status: 'delivered', deliveredAt: Timestamp.now() });
      updated++;
    } else if (res.status === 'failed') {
      await d.ref.update({ status: 'failed', failedAt: Timestamp.now(), error: res.error ?? 'Delivery failed.' });
      updated++;
    }
  }
  return updated;
}

/**
 * Safety net for hosts without Firestore triggers (Vercel + Spark): emergency summaries still 'pending' a minute after
 * sending (the post-response job died), and offline emergency requests still 'queued' after sync (the app never
 * called processReferralRequest). Both operations are idempotent.
 */
async function sweepPendingWork(nowMs: number): Promise<number> {
  let count = 0;
  const minuteAgo = Timestamp.fromMillis(nowMs - 60_000);
  const pending = await db().collection(COLLECTIONS.referrals).where('summary.state', '==', 'pending').limit(50).get();
  for (const d of pending.docs) {
    const r = d.data() as ReferralDoc;
    if (r.type !== 'emergency' || r.createdAt.toMillis() > minuteAgo.toMillis()) continue;
    await runSummary(d.id);
    count++;
  }
  const queued = await db().collection(COLLECTIONS.referralRequests).where('state', '==', 'queued').limit(50).get();
  for (const d of queued.docs) {
    const created = (d.data() as { createdAt?: Timestamp }).createdAt;
    if (created && created.toMillis() > minuteAgo.toMillis()) continue;
    await processReferralRequest(d.id);
    count++;
  }
  return count;
}

/** Runs every maintenance step; each step is isolated so one failure does not stop the rest. */
export async function runCleanup(nowMs: number = Date.now()): Promise<Record<string, number | string>> {
  const results: Record<string, number | string> = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      results[name] = await fn();
    } catch (err) {
      results[name] = 'error';
      logger.error(`cleanup: ${name} failed`, { message: err instanceof Error ? err.message : String(err) });
    }
  };
  await step('expiredReferrals', () => expireReferrals(nowMs));
  // Token docs are kept 7 days past expiry so "expired" (vs "invalid") can still be reported to hospitals.
  await step('staleSummariesFailed', () => failStaleSummaries(nowMs));
  await step('deletedTokens', () => deleteWhereBefore(COLLECTIONS.referralTokens, 'expiresAt' satisfies keyof ReferralTokenDoc, nowMs - 7 * DAY_MS));
  await step('deletedRateLimits', () => deleteWhereBefore(COLLECTIONS.rateLimits, 'expiresAt', nowMs));
  await step('smsStatusUpdates', refreshSmsStatuses);
  await step('pendingWorkSwept', () => sweepPendingWork(nowMs));
  logger.info('cleanup complete', results);
  return results;
}

export const scheduledCleanup = onSchedule({ schedule: 'every 60 minutes', timeZone: 'Asia/Manila', secrets: smsSecrets(), timeoutSeconds: 300 }, async () => {
  await runCleanup();
});
