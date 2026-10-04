import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type { AuditActorKind, GenerateReferralPdfRequest, GenerateReferralPdfResponse } from '../shared/contracts';
import type { Role } from '../shared/types';
import { assertClinicMember, requireStaff } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { MESSAGES, maraError, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { getClinic, getPatient, getReferral, listVisits } from '../repositories';
import { buildHospitalView, buildPatientExportData } from '../services/referralView';
import { resolveHospitalToken, tokenFailureError } from '../services/hospitalAccess';
import { buildReferralPdf } from '../services/pdf/buildPdf';

const requestSchema = z.union([
  z.object({ token: z.string().max(200) }).strict(),
  z.object({ referralId: z.string().trim().min(1).max(64) }).strict(),
  z.object({ patientId: z.string().trim().min(1).max(64) }).strict(),
]);

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function auditPdf(base: { actorKind: AuditActorKind; actorUid: string | null; actorRole: Role | null; clinicId: string; patientId: string; referralId: string | null }, kind: string) {
  await Promise.all([
    writeAudit({ ...base, action: 'pdf_generated', details: { kind } }),
    writeAudit({ ...base, action: 'pdf_downloaded', details: { kind } }),
  ]);
}

/** Returns the PDF as base64 (never stored at a public URL). */
export const generateReferralPdf = onCall<GenerateReferralPdfRequest>(callableOptions({ memory: '512MiB', timeoutSeconds: 60 }), async (request): Promise<GenerateReferralPdfResponse> => {
  try {
    const parsed = requestSchema.safeParse(request.data);
    if (!parsed.success) throw maraError('invalid-argument', 'VALIDATION', 'Invalid PDF request.');
    const data = parsed.data;
    const generatedAtMillis = Date.now();

    if ('token' in data) {
      const resolved = await resolveHospitalToken(request, data.token, generatedAtMillis);
      if (!resolved.ok) throw tokenFailureError(resolved.reason);
      const { referral, token } = resolved;
      const [patient, visits] = await Promise.all([getPatient(referral.patientId), listVisits(referral.patientId)]);
      if (!patient) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      const view = buildHospitalView(referral, patient, visits, token.expiresAt.toMillis());
      const bytes = await buildReferralPdf({ view, generatedAtMillis });
      await auditPdf({ actorKind: 'hospital_link', actorUid: null, actorRole: null, clinicId: referral.clinicId, patientId: referral.patientId, referralId: referral.referralId }, 'referral');
      return { fileName: `${referral.referralId}.pdf`, base64: toBase64(bytes) };
    }

    const ctx = await requireStaff(request);
    if ('referralId' in data) {
      const referral = await getReferral(data.referralId);
      if (!referral) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      assertClinicMember(ctx, referral.clinicId);
      const [patient, visits] = await Promise.all([getPatient(referral.patientId), listVisits(referral.patientId)]);
      if (!patient) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      const view = buildHospitalView(referral, patient, visits, referral.link?.expiresAt?.toMillis() ?? 0);
      const bytes = await buildReferralPdf({ view, generatedAtMillis });
      await auditPdf({ actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId: referral.clinicId, patientId: referral.patientId, referralId: referral.referralId }, 'referral');
      return { fileName: `${referral.referralId}.pdf`, base64: toBase64(bytes) };
    }

    const patient = await getPatient(data.patientId);
    if (!patient) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
    assertClinicMember(ctx, patient.clinicId);
    const [visits, clinic] = await Promise.all([listVisits(patient.patientId), getClinic(patient.clinicId)]);
    const bytes = await buildReferralPdf({ view: null, patientOnly: buildPatientExportData(patient, visits, clinic), generatedAtMillis });
    await auditPdf({ actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId: patient.clinicId, patientId: patient.patientId, referralId: null }, 'patient_record');
    return { fileName: `${patient.patientId}-record.pdf`, base64: toBase64(bytes) };
  } catch (err) {
    throw toHttpsError(err, 'Unable to generate the PDF. Please try again.');
  }
});
