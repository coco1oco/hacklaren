import { Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/logger';
import type { ReferralDoc, ReferralRequestDoc } from '../shared/contracts';
import { emergencyReferralInputSchema } from '../shared/schemas';
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
 * Offline emergency queue. The client creates referralRequests/{clientRequestId} (works offline);
 * once synced, this turns it into a real referral and SMSes the link to the midwife and hospital.
 */
export const onReferralRequestCreated = onDocumentCreated({ document: 'referralRequests/{requestId}', secrets: smsSecrets(), timeoutSeconds: 120 }, async (event) => {
  const requestId = event.params.requestId;
  const req = event.data?.data() as ReferralRequestDoc | undefined;
  const ref = referralRequestRef(requestId);
  const fail = async (error: string) => {
    logger.warn('Offline referral request rejected', { requestId, error });
    await ref.update({ state: 'failed', error, processedAt: Timestamp.now() }).catch(() => undefined);
  };
  if (!req) return;
  if (req.state !== 'queued') return;

  try {
    if (req.type !== 'emergency') return fail('Only emergency referrals can be queued offline.');
    const parsed = emergencyReferralInputSchema.safeParse({
      patientId: req.patientId,
      hospitalId: req.hospitalId,
      reasonCode: req.reasonCode,
      reasonText: req.reasonText ?? '',
      clientRequestId: req.clientRequestId,
    });
    if (!parsed.success) return fail('Referral request is incomplete. Please create the referral again.');
    if (parsed.data.clientRequestId !== requestId) return fail('Referral request id mismatch.');

    const staff = typeof req.createdBy === 'string' ? await getStaff(req.createdBy) : null;
    if (!staff || staff.active !== true || staff.uid !== req.createdBy) return fail('Your account is inactive or not found.');
    if (staff.role !== 'midwife' && staff.role !== 'clinic_admin') return fail('Your role cannot create referrals.');
    if (!staff.clinicId || staff.clinicId !== req.clinicId) return fail('Clinic mismatch.');

    const { result, doc, loaded } = await createEmergencyReferral({ uid: staff.uid, role: staff.role, staff }, parsed.data, { source: 'offline_queue' });
    await ref.update({ state: 'processed', referralId: result.referralId, error: null, processedAt: Timestamp.now() });
    // The midwife never saw the raw token on this path, so the link goes out by SMS (midwife + hospital).
    if (doc && loaded && result.link) await notifyEmergency(doc, loaded, result.link);
  } catch (err) {
    const message = err instanceof Error && 'httpErrorCode' in err ? err.message : 'Unable to send referral. Your patient record has not been lost.';
    logger.error('Offline referral processing failed', { requestId, message: err instanceof Error ? err.message : String(err) });
    await fail(message);
  }
});
