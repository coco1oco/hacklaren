// Hospital-facing callables. NO Firebase Auth: access is by link token only (hashed lookup + rate limit).
import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { GetReferralViewRequest, GetReferralViewResponse, ReferralDoc, UpdateReferralStatusRequest, UpdateReferralStatusResponse } from '../shared/contracts';
import type { AuditAction } from '../shared/types';
import { declineReasonSchema } from '../shared/schemas';
import { canTransition, type HospitalAction } from '../shared/referralStatus';
import { writeAudit, auditInTx } from '../lib/audit';
import { db } from '../lib/firebase';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { getPatient, getReferral, getToken, listVisits, referralRef } from '../repositories';
import { buildHospitalView } from '../services/referralView';
import { resolveHospitalToken, tokenFailureError, tokenState } from '../services/hospitalAccess';
import * as sms from '../services/sms/messages';
import { sendSms } from '../services/sms/sendSms';

export const getReferralView = onCall<GetReferralViewRequest>(callableOptions(), async (request): Promise<GetReferralViewResponse> => {
  try {
    const resolved = await resolveHospitalToken(request, (request.data as Partial<GetReferralViewRequest> | undefined)?.token);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const { referral, token } = resolved;
    const [patient, visits] = await Promise.all([getPatient(referral.patientId), listVisits(referral.patientId)]);
    if (!patient) return { ok: false, reason: 'invalid' };
    const view = buildHospitalView(referral, patient, visits, token.expiresAt.toMillis());
    await writeAudit({
      action: 'referral_viewed',
      actorKind: 'hospital_link',
      actorUid: null,
      actorRole: null,
      clinicId: referral.clinicId,
      patientId: referral.patientId,
      referralId: referral.referralId,
      details: { channel: 'hospital_link' },
    });
    return { ok: true, view };
  } catch (err) {
    throw toHttpsError(err, 'Unable to load the referral. Please check your connection and try again.');
  }
});

const updateSchema = z.object({
  token: z.unknown(),
  status: z.enum(['ACKNOWLEDGED', 'DECLINED', 'ARRIVED']),
  declineReason: z.string().optional(),
  actorName: z.string().trim().max(120).optional(),
});

const AUDIT_FOR: Record<HospitalAction, AuditAction> = {
  ACKNOWLEDGED: 'referral_acknowledged',
  DECLINED: 'referral_declined',
  ARRIVED: 'patient_arrived',
};

export const updateReferralStatus = onCall<UpdateReferralStatusRequest>(callableOptions({ sms: true }), async (request): Promise<UpdateReferralStatusResponse> => {
  try {
    const input = parseInput(updateSchema, request.data);
    let declineReason: string | null = null;
    if (input.status === 'DECLINED') declineReason = parseInput(declineReasonSchema, input.declineReason ?? '');

    const resolved = await resolveHospitalToken(request, input.token);
    if (!resolved.ok) throw tokenFailureError(resolved.reason);
    const target = input.status;

    const updated = await db().runTransaction(async (tx) => {
      // Re-read token + referral inside the transaction (link may have been revoked/rotated meanwhile).
      const token = await getToken(resolved.tokenHash, tx);
      const state = tokenState(token, Date.now());
      if (state !== 'ok') throw tokenFailureError(state);
      const r = await getReferral(resolved.referral.referralId, tx);
      if (!r) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      const check = canTransition(r.type, r.status, target, 'hospital');
      if (!check.allowed) throw maraError('failed-precondition', 'INVALID_TRANSITION', check.reason ?? 'This status change is not allowed.');
      const now = Timestamp.now();
      const note = input.actorName ? `Recorded by ${input.actorName}` : null;
      const patch: Record<string, unknown> = {
        status: target,
        statusHistory: [...r.statusHistory, { status: target, at: now, actor: 'hospital', uid: null, note }],
        updatedAt: now,
      };
      if (target === 'ACKNOWLEDGED') patch.acknowledgedAt = now;
      if (target === 'ARRIVED') patch.arrivedAt = now;
      if (target === 'DECLINED') {
        patch.declinedAt = now;
        patch.declineReason = declineReason;
      }
      tx.update(referralRef(r.referralId), patch);
      // Audit carries no clinical text (decline reason is stored on the referral only).
      auditInTx(tx, {
        action: AUDIT_FOR[target],
        actorKind: 'hospital_link',
        actorUid: null,
        actorRole: null,
        clinicId: r.clinicId,
        patientId: r.patientId,
        referralId: r.referralId,
        details: { from: r.status, to: target, actorNameProvided: !!input.actorName },
      });
      return { ...r, status: target } as ReferralDoc;
    });

    if (target === 'ACKNOWLEDGED' || target === 'DECLINED') {
      await sendSms({
        recipient: updated.midwife.contactNumber,
        recipientRole: 'midwife',
        messageType: target === 'ACKNOWLEDGED' ? 'midwife_status_acknowledged' : 'midwife_status_declined',
        referralId: updated.referralId,
        clinicId: updated.clinicId,
        message: target === 'ACKNOWLEDGED' ? sms.midwifeStatusAcknowledged(updated.referralId, updated.hospital.name) : sms.midwifeStatusDeclined(updated.referralId, updated.hospital.name),
      });
    }
    return { status: updated.status };
  } catch (err) {
    throw toHttpsError(err, 'Unable to update the referral status. Please check your connection and try again.');
  }
});
