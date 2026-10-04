import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { z } from 'zod';
import type { ProcessReferralRequestRequest, ProcessReferralRequestResponse, ReferralDoc, ReferralRequestDoc } from '../shared/contracts';
import { emergencyReferralInputSchema } from '../shared/schemas';
import { requireStaff } from '../lib/auth';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { getStaff, referralRequestRef } from '../repositories';
import { runSummary } from '../services/summary/runSummary';
import { smsSecrets } from '../services/sms/provider';
import { createEmergencyReferral, notifyEmergency } from './core';

/** Emergency AI summary runs AFTER the referral was sent. Nothing in the send path waits for this. */
export const onReferralCreated = onDocumentCreated({ document: 'referrals/{referralId}', timeoutSeconds: 120 }, async (event) => {
  const data = event.data?.data() as ReferralDoc | undefined;
  if (!data || data.type !== 'emergency') return;
  if (data.summary?.state !== 'pending') return;
  await runSummary(event.params.referralId);
});

/**
 * Turns an offline emergency request (referralRequests/{requestId}) into a real referral.
 * Idempotent: createEmergencyReferral dedupes on clientRequestId (= requestId), and already processed/failed
 * requests are returned as-is, so the trigger, the client "on sync" call, and the cron fallback can all call it.
 */
export async function processReferralRequest(requestId: string): Promise<ProcessReferralRequestResponse> {
  const ref = referralRequestRef(requestId);
  const snap = await ref.get();
  const req = snap.exists ? (snap.data() as ReferralRequestDoc) : null;
  if (!req) return { state: 'failed', referralId: null, error: 'Referral request not found.' };
  if (req.state !== 'queued') return { state: req.state, referralId: req.referralId ?? null, error: req.error ?? null };

  const fail = async (error: string): Promise<ProcessReferralRequestResponse> => {
    logger.warn('Offline referral request rejected', { requestId, error });
    await ref.update({ state: 'failed', error, processedAt: Timestamp.now() }).catch(() => undefined);
    return { state: 'failed', referralId: null, error };
  };

  try {
    if (req.type !== 'emergency') return await fail('Only emergency referrals can be queued offline.');
    const parsed = emergencyReferralInputSchema.safeParse({
      patientId: req.patientId,
      hospitalId: req.hospitalId,
      reasonCode: req.reasonCode,
      reasonText: req.reasonText ?? '',
      clientRequestId: req.clientRequestId,
    });
    if (!parsed.success) return await fail('Referral request is incomplete. Please create the referral again.');
    if (parsed.data.clientRequestId !== requestId) return await fail('Referral request id mismatch.');

    const staff = typeof req.createdBy === 'string' ? await getStaff(req.createdBy) : null;
    if (!staff || staff.active !== true || staff.uid !== req.createdBy) return await fail('Your account is inactive or not found.');
    if (staff.role !== 'midwife' && staff.role !== 'clinic_admin') return await fail('Your role cannot create referrals.');
    if (!staff.clinicId || staff.clinicId !== req.clinicId) return await fail('Clinic mismatch.');

    const { result, doc, loaded } = await createEmergencyReferral({ uid: staff.uid, role: staff.role, staff }, parsed.data, { source: 'offline_queue' });
    await ref.update({ state: 'processed', referralId: result.referralId, error: null, processedAt: Timestamp.now() });
    // The midwife never saw the raw token on this path, so the link goes out by SMS (midwife + hospital).
    // A deduplicated call returns no link, so SMS is never sent twice.
    if (doc && loaded && result.link) await notifyEmergency(doc, loaded, result.link);
    return { state: 'processed', referralId: result.referralId, error: null };
  } catch (err) {
    const message = err instanceof Error && 'httpErrorCode' in err ? err.message : 'Unable to send referral. Your patient record has not been lost.';
    logger.error('Offline referral processing failed', { requestId, message: err instanceof Error ? err.message : String(err) });
    return fail(message);
  }
}

/** Firebase (Blaze) path: process as soon as the queued request syncs. */
export const onReferralRequestCreated = onDocumentCreated({ document: 'referralRequests/{requestId}', secrets: smsSecrets(), timeoutSeconds: 120 }, async (event) => {
  await processReferralRequest(event.params.requestId);
});

const processSchema = z.object({ requestId: z.string().uuid() });

/**
 * Client-triggered processing (used where Firestore triggers are unavailable, e.g. Vercel + Spark): the midwife's
 * app calls this once its queued request has synced. Only the request's creator may trigger it.
 */
export async function processReferralRequestHandler(request: Parameters<typeof requireStaff>[0] & { data: unknown }): Promise<ProcessReferralRequestResponse> {
  try {
    const ctx = await requireStaff(request);
    const { requestId } = parseInput(processSchema, request.data);
    const snap = await referralRequestRef(requestId).get();
    const req = snap.exists ? (snap.data() as ReferralRequestDoc) : null;
    if (!req || req.createdBy !== ctx.uid || req.clinicId !== ctx.clinicId) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
    return await processReferralRequest(requestId);
  } catch (err) {
    throw toHttpsError(err, MESSAGES.sendFailed);
  }
}

export const processReferralRequestCallable = onCall<ProcessReferralRequestRequest>(callableOptions({ sms: true }), (request) => processReferralRequestHandler(request));
