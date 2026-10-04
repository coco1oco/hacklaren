import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { GenerateSummaryRequest, GenerateSummaryResponse, SendReferralRequest, SendReferralResponse } from '../shared/contracts';
import type { QSummaryContent } from '../shared/types';
import { qSummaryContentSchema } from '../shared/schemas';
import { canTransition } from '../shared/referralStatus';
import { assertReferralWorker, requireStaff } from '../lib/auth';
import { auditInTx } from '../lib/audit';
import { db } from '../lib/firebase';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { getHospital, getPatient, getReferral, referralRef } from '../repositories';
import { createTokenInTx, issueLink, linkResult } from '../services/links';
import { SUMMARY_BUSY_MESSAGE, isSummaryGenerationActive, runSummary } from '../services/summary/runSummary';
import * as sms from '../services/sms/messages';
import { sendAll } from '../services/sms/sendSms';

const referralIdSchema = z.object({ referralId: z.string().trim().min(1).max(64) });

export const generateSummary = onCall<GenerateSummaryRequest>(callableOptions({ timeoutSeconds: 120 }), async (request): Promise<GenerateSummaryResponse> => {
  try {
    const ctx = await requireStaff(request);
    const { referralId } = parseInput(referralIdSchema, request.data);
    const referral = await getReferral(referralId);
    if (!referral) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
    assertReferralWorker(ctx, referral.clinicId);
    if (referral.type !== 'checkup') throw maraError('failed-precondition', 'INVALID_TRANSITION', 'Emergency summaries are generated automatically after sending.');
    if (referral.status !== 'CREATED') throw maraError('failed-precondition', 'INVALID_TRANSITION', 'The summary can only be generated before the referral is sent.');
    // Fast-path guard; the authoritative check (incl. stale 'generating' takeover) is inside runSummary's start transaction.
    if (isSummaryGenerationActive(referral.summary, Date.now())) throw maraError('failed-precondition', 'SUMMARY_NOT_READY', SUMMARY_BUSY_MESSAGE);

    const result = await runSummary(referralId);
    if (!result.ok && result.busy) throw maraError('failed-precondition', 'SUMMARY_NOT_READY', SUMMARY_BUSY_MESSAGE);
    if (result.ok) return { ok: true, state: 'ready', content: result.content, provider: result.provider };
    return { ok: false, state: 'failed', error: MESSAGES.aiUnavailable };
  } catch (err) {
    throw toHttpsError(err, MESSAGES.aiUnavailable);
  }
});

const sendReferralSchema = z.object({ referralId: z.string().trim().min(1).max(64), approvedSummary: qSummaryContentSchema });

/** Stable comparison of summary content (used to set the `edited` flag). */
export function summaryEdited(original: QSummaryContent | null, approved: QSummaryContent): boolean {
  if (!original) return true;
  const norm = (c: QSummaryContent) =>
    JSON.stringify([c.summary.trim(), c.keyFindings.map((s) => s.trim()), c.riskFlags.map((s) => s.trim()), c.medications.map((s) => s.trim()), c.reasonForReferral.trim(), c.abnormalTrends.map((s) => s.trim())]);
  return norm(original) !== norm(approved);
}

export const sendReferral = onCall<SendReferralRequest>(callableOptions({ sms: true }), async (request): Promise<SendReferralResponse> => {
  try {
    const ctx = await requireStaff(request);
    const input = parseInput(sendReferralSchema, request.data);
    const pre = await getReferral(input.referralId);
    if (!pre) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
    assertReferralWorker(ctx, pre.clinicId);

    const { link, referral } = await db().runTransaction(async (tx) => {
      const r = await getReferral(input.referralId, tx);
      if (!r) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      if (r.type !== 'checkup') throw maraError('failed-precondition', 'INVALID_TRANSITION', 'Emergency referrals are sent when created.');
      const check = canTransition(r.type, r.status, 'SENT', 'midwife');
      if (!check.allowed) throw maraError('failed-precondition', 'INVALID_TRANSITION', check.reason ?? 'This referral cannot be sent.');
      if (r.summary.state !== 'ready' && r.summary.state !== 'approved') {
        throw maraError('failed-precondition', 'SUMMARY_NOT_READY', 'Generate and review the Q summary before sending. If the Q summary is unavailable, retry the summary.');
      }
      const nowMs = Date.now();
      const now = Timestamp.fromMillis(nowMs);
      const issued = issueLink(nowMs);
      const edited = summaryEdited(r.summary.content, input.approvedSummary);
      tx.update(referralRef(r.referralId), {
        status: 'SENT',
        statusHistory: [...r.statusHistory, { status: 'SENT', at: now, actor: 'midwife', uid: ctx.uid, note: null }],
        sentAt: now,
        updatedAt: now,
        'summary.state': 'approved',
        'summary.approvedContent': input.approvedSummary,
        'summary.edited': edited,
        'summary.approvedAt': now,
        'summary.approvedBy': ctx.uid,
        link: { expiresAt: Timestamp.fromMillis(issued.expiresAtMillis), revoked: false, issuedAt: now, issueCount: (r.link?.issueCount ?? 0) + 1 },
      });
      createTokenInTx(tx, r.referralId, r.clinicId, issued, nowMs);
      const audit = { actorKind: 'user' as const, actorUid: ctx.uid, actorRole: ctx.role, clinicId: r.clinicId, patientId: r.patientId, referralId: r.referralId };
      auditInTx(tx, { ...audit, action: 'summary_approved', details: { edited } });
      auditInTx(tx, { ...audit, action: 'referral_sent', details: { type: 'checkup' } });
      return { link: issued, referral: r };
    });

    // SMS after commit; failures never fail the send.
    const [patient, hospital] = await Promise.all([getPatient(referral.patientId), getHospital(referral.hospitalId)]);
    const base = { referralId: referral.referralId, clinicId: referral.clinicId };
    const hospitalMobile = sms.normalizePhMobile(hospital?.phone ?? referral.hospital.phone);
    await sendAll([
      patient ? { ...base, recipient: patient.contactNumber, recipientRole: 'patient', messageType: 'patient_referral_created', message: sms.patientReferralCreated(referral.referralId, referral.hospital.name) } : null,
      hospitalMobile ? { ...base, recipient: hospitalMobile, recipientRole: 'hospital', messageType: 'hospital_referral_link', message: sms.hospitalReferralLink(referral.referralId, referral.clinic.name, link.url, false) } : null,
    ]);
    return { referralId: referral.referralId, status: 'SENT', link: linkResult(link) };
  } catch (err) {
    throw toHttpsError(err, MESSAGES.sendFailed);
  }
});
