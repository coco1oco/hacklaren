// Referral creation workflows shared by the createReferral callable and the offline-queue trigger.
import { Timestamp, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import type { ClinicDoc, HospitalDoc, PatientDoc, ReferralDoc, ReferralSummary, StaffDoc } from '../shared/contracts';
import type { Role } from '../shared/types';
import { EMERGENCY_REASONS } from '../shared/types';
import type { CheckupReferralInput, EmergencyReferralInput } from '../shared/schemas';
import { newReferralId } from '../shared/ids';
import { db } from '../lib/firebase';
import { auditInTx } from '../lib/audit';
import { MESSAGES, maraError } from '../lib/errors';
import { activeTokensQuery, getClinic, getHospital, getPatient, referralByClientRequestQuery, referralRef } from '../repositories';
import { createTokenInTx, issueLink, type IssuedLink } from '../services/links';
import * as sms from '../services/sms/messages';
import { sendAll, type SendSmsInput } from '../services/sms/sendSms';

export interface ReferralActor {
  uid: string;
  role: Role;
  staff: StaffDoc;
}

export interface CreateResult {
  referralId: string;
  status: ReferralDoc['status'];
  link: IssuedLink | null;
  deduplicated: boolean;
}

export function emptySummary(state: ReferralSummary['state']): ReferralSummary {
  return { state, provider: null, content: null, approvedContent: null, edited: false, generatedAt: null, approvedAt: null, approvedBy: null, error: null, attempts: 0 };
}

interface Loaded {
  patient: PatientDoc;
  hospital: HospitalDoc;
  clinic: ClinicDoc;
}

async function loadForReferral(actor: ReferralActor, patientId: string, hospitalId: string): Promise<Loaded> {
  const clinicId = actor.staff.clinicId;
  if (!clinicId) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
  const [patient, hospital, clinic] = await Promise.all([getPatient(patientId), getHospital(hospitalId), getClinic(clinicId)]);
  // Same message for "missing" and "other clinic" so patient ids of other clinics cannot be probed.
  if (!patient || patient.clinicId !== clinicId) throw maraError('not-found', 'NOT_FOUND', 'Patient record not found in your clinic.');
  if (patient.active === false) throw maraError('failed-precondition', 'VALIDATION', 'This patient record is inactive.');
  if (!hospital || hospital.active !== true) throw maraError('failed-precondition', 'HOSPITAL_NOT_ELIGIBLE', 'The selected hospital is not available for referrals.');
  if (!clinic) throw maraError('failed-precondition', 'NOT_FOUND', 'Clinic record not found.');
  return { patient, hospital, clinic };
}

function baseDoc(
  referralId: string,
  type: ReferralDoc['type'],
  actor: ReferralActor,
  loaded: Loaded,
  hospitalId: string,
  reason: ReferralDoc['reason'],
  clientRequestId: string,
  now: Timestamp,
): ReferralDoc {
  const { patient, hospital, clinic } = loaded;
  return {
    referralId,
    type,
    status: 'CREATED',
    statusHistory: [{ status: 'CREATED', at: now, actor: 'midwife', uid: actor.uid, note: null }],
    patientId: patient.patientId,
    patientName: patient.name,
    clinicId: patient.clinicId,
    hospitalId,
    hospital: { name: hospital.name, phone: hospital.phone, address: hospital.address },
    clinic: { name: clinic.name, contactNumber: clinic.contactNumber, address: clinic.address },
    midwife: { uid: actor.uid, name: actor.staff.name, contactNumber: actor.staff.contactNumber },
    reason,
    urgency: type === 'emergency' ? 'emergency' : 'routine',
    summary: emptySummary(type === 'emergency' ? 'pending' : 'not_requested'),
    link: { expiresAt: null, revoked: false, issuedAt: null, issueCount: 0 },
    declineReason: null,
    cancelReason: null,
    consentAtReferral: patient.consent?.dataSharingForReferral === true,
    clientRequestId,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    sentAt: null,
    acknowledgedAt: null,
    declinedAt: null,
    arrivedAt: null,
    cancelledAt: null,
    expiredAt: null,
  };
}

/** Idempotency check inside the transaction (query reads are part of the transaction's read set). */
async function findExisting(tx: Transaction, clinicId: string, clientRequestId: string): Promise<ReferralDoc | null> {
  const snap = await tx.get(referralByClientRequestQuery(clinicId, clientRequestId));
  return snap.empty ? null : (snap.docs[0].data() as ReferralDoc);
}

/** Emergency: SENT immediately + link, in one transaction. SMS afterwards; AI runs from the Firestore trigger. */
export async function createEmergencyReferral(
  actor: ReferralActor,
  input: EmergencyReferralInput,
  opts: { source: 'callable' | 'offline_queue' },
): Promise<{ result: CreateResult; doc: ReferralDoc | null; loaded: Loaded | null }> {
  const loaded = await loadForReferral(actor, input.patientId, input.hospitalId);
  const reasonDef = EMERGENCY_REASONS.find((r) => r.code === input.reasonCode);
  const reason = { code: input.reasonCode, label: reasonDef?.label ?? 'Other', text: input.reasonText };

  const out = await db().runTransaction(async (tx) => {
    const existing = await findExisting(tx, loaded.patient.clinicId, input.clientRequestId);
    if (existing) return { result: { referralId: existing.referralId, status: existing.status, link: null, deduplicated: true }, doc: null };

    const nowMs = Date.now();
    const now = Timestamp.fromMillis(nowMs);
    const referralId = newReferralId();
    const link = issueLink(nowMs);
    const doc = baseDoc(referralId, 'emergency', actor, loaded, input.hospitalId, reason, input.clientRequestId, now);
    doc.status = 'SENT';
    doc.statusHistory.push({ status: 'SENT', at: now, actor: 'midwife', uid: actor.uid, note: null });
    doc.sentAt = now;
    doc.link = { expiresAt: Timestamp.fromMillis(link.expiresAtMillis), revoked: false, issuedAt: now, issueCount: 1 };

    tx.create(referralRef(referralId), doc);
    createTokenInTx(tx, referralId, doc.clinicId, link, nowMs);
    const audit = { actorKind: 'user' as const, actorUid: actor.uid, actorRole: actor.role, clinicId: doc.clinicId, patientId: doc.patientId, referralId };
    auditInTx(tx, { ...audit, action: 'referral_created', details: { type: 'emergency', source: opts.source, consentAtReferral: doc.consentAtReferral, emergencyConsentOverride: !doc.consentAtReferral } });
    auditInTx(tx, { ...audit, action: 'referral_sent', details: { type: 'emergency', source: opts.source } });
    return { result: { referralId, status: doc.status, link, deduplicated: false }, doc };
  });
  return { ...out, loaded: out.doc ? loaded : null };
}

/** Builds the SMS fan-out for a newly sent emergency referral. */
export function emergencySmsBatch(doc: ReferralDoc, loaded: Loaded, link: IssuedLink): (SendSmsInput | null)[] {
  const base = { referralId: doc.referralId, clinicId: doc.clinicId };
  const hospitalMobile = sms.normalizePhMobile(loaded.hospital.phone);
  const midwifeMobile = sms.normalizePhMobile(doc.midwife.contactNumber);
  return [
    hospitalMobile ? { ...base, recipient: hospitalMobile, recipientRole: 'hospital', messageType: 'hospital_referral_link', message: sms.hospitalReferralLink(doc.referralId, doc.clinic.name, link.url, true) } : null,
    { ...base, recipient: loaded.patient.contactNumber, recipientRole: 'patient', messageType: 'patient_referral_created', message: sms.patientReferralCreated(doc.referralId, doc.hospital.name) },
    loaded.clinic.bhwContactNumber ? { ...base, recipient: loaded.clinic.bhwContactNumber, recipientRole: 'bhw', messageType: 'emergency_alert_bhw', message: sms.emergencyAlert(doc.referralId, doc.clinic.name, doc.hospital.name) } : null,
    loaded.clinic.mhoContactNumber ? { ...base, recipient: loaded.clinic.mhoContactNumber, recipientRole: 'mho', messageType: 'emergency_alert_mho', message: sms.emergencyAlert(doc.referralId, doc.clinic.name, doc.hospital.name) } : null,
    midwifeMobile ? { ...base, recipient: midwifeMobile, recipientRole: 'midwife', messageType: 'midwife_referral_link', message: sms.midwifeReferralLink(doc.referralId, doc.hospital.name, link.url) } : null,
  ];
}

export async function notifyEmergency(doc: ReferralDoc, loaded: Loaded, link: IssuedLink): Promise<void> {
  try {
    await sendAll(emergencySmsBatch(doc, loaded, link));
  } catch (err) {
    logger.error('Emergency SMS fan-out failed', { referralId: doc.referralId, message: err instanceof Error ? err.message : String(err) });
  }
}

/** Checkup: CREATED, no link until sendReferral. Requires consent and a DOH-networked hospital. */
export async function createCheckupReferral(actor: ReferralActor, input: CheckupReferralInput): Promise<CreateResult> {
  const loaded = await loadForReferral(actor, input.patientId, input.hospitalId);
  if (loaded.patient.consent?.dataSharingForReferral !== true) {
    throw maraError('failed-precondition', 'CONSENT_REQUIRED', 'Patient consent for data sharing is required before a checkup referral. Record consent in the patient profile.');
  }
  if (loaded.hospital.dohNetworked !== true) {
    throw maraError('failed-precondition', 'HOSPITAL_NOT_ELIGIBLE', 'Checkup referrals can only be sent to DOH-networked hospitals.');
  }
  return db().runTransaction(async (tx) => {
    const existing = await findExisting(tx, loaded.patient.clinicId, input.clientRequestId);
    if (existing) return { referralId: existing.referralId, status: existing.status, link: null, deduplicated: true };
    const now = Timestamp.now();
    const referralId = newReferralId();
    const doc = baseDoc(referralId, 'checkup', actor, loaded, input.hospitalId, { code: 'checkup', label: 'Checkup referral', text: input.reasonText }, input.clientRequestId, now);
    tx.create(referralRef(referralId), doc);
    auditInTx(tx, {
      action: 'referral_created',
      actorKind: 'user',
      actorUid: actor.uid,
      actorRole: actor.role,
      clinicId: doc.clinicId,
      patientId: doc.patientId,
      referralId,
      details: { type: 'checkup', consentAtReferral: true },
    });
    return { referralId, status: doc.status, link: null, deduplicated: false };
  });
}

/** Reads active token docs (call before any transaction writes). */
export async function readActiveTokens(tx: Transaction, referralId: string): Promise<DocumentReference[]> {
  const snap = await tx.get(activeTokensQuery(referralId));
  return snap.docs.map((d) => d.ref);
}

export function revokeTokensInTx(tx: Transaction, refs: DocumentReference[], now: Timestamp): void {
  for (const ref of refs) tx.update(ref, { revoked: true, revokedAt: now });
}
