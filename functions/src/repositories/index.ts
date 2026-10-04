// Thin Firestore accessors. All writes to referrals/tokens/smsLogs/staff happen via the Admin SDK here.
import type { DocumentReference, Query, Transaction } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  type ClinicDoc,
  type HospitalDoc,
  type PatientDoc,
  type ReferralDoc,
  type ReferralTokenDoc,
  type SmsLogDoc,
  type StaffDoc,
  type VisitDoc,
} from '../shared/contracts';
import { db } from '../lib/firebase';

async function getTyped<T>(ref: DocumentReference, tx?: Transaction): Promise<T | null> {
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? (snap.data() as T) : null;
}

// ── patients / visits ───────────────────────────────────────────────────────
export const patientRef = (patientId: string) => db().collection(COLLECTIONS.patients).doc(patientId);
export const getPatient = (patientId: string, tx?: Transaction) => getTyped<PatientDoc>(patientRef(patientId), tx);

export async function listVisits(patientId: string): Promise<VisitDoc[]> {
  const snap = await patientRef(patientId).collection(COLLECTIONS.visits).get();
  return snap.docs.map((d) => ({ ...(d.data() as VisitDoc), visitId: (d.data() as VisitDoc).visitId ?? d.id }));
}

// ── hospitals / clinics / staff ─────────────────────────────────────────────
export const hospitalRef = (id: string) => db().collection(COLLECTIONS.hospitals).doc(id);
export const getHospital = (id: string, tx?: Transaction) => getTyped<HospitalDoc>(hospitalRef(id), tx);

export const clinicRef = (id: string) => db().collection(COLLECTIONS.clinics).doc(id);
export const getClinic = (id: string, tx?: Transaction) => getTyped<ClinicDoc>(clinicRef(id), tx);

export const staffRef = (uid: string) => db().collection(COLLECTIONS.midwives).doc(uid);
export const getStaff = (uid: string, tx?: Transaction) => getTyped<StaffDoc>(staffRef(uid), tx);

// ── referrals ───────────────────────────────────────────────────────────────
export const referralRef = (id: string) => db().collection(COLLECTIONS.referrals).doc(id);
export const getReferral = (id: string, tx?: Transaction) => getTyped<ReferralDoc>(referralRef(id), tx);

export function referralByClientRequestQuery(clinicId: string, clientRequestId: string): Query {
  return db().collection(COLLECTIONS.referrals).where('clientRequestId', '==', clientRequestId).where('clinicId', '==', clinicId).limit(1);
}

// ── referral tokens (doc id = SHA-256 hex of the raw token) ────────────────
export const tokenRef = (tokenHash: string) => db().collection(COLLECTIONS.referralTokens).doc(tokenHash);
export const getToken = (tokenHash: string, tx?: Transaction) => getTyped<ReferralTokenDoc>(tokenRef(tokenHash), tx);

export function activeTokensQuery(referralId: string): Query {
  return db().collection(COLLECTIONS.referralTokens).where('referralId', '==', referralId).where('revoked', '==', false);
}

// ── sms logs ────────────────────────────────────────────────────────────────
export const smsLogRef = (id: string) => db().collection(COLLECTIONS.smsLogs).doc(id);
export const getSmsLog = (id: string) => getTyped<SmsLogDoc>(smsLogRef(id));
export const newSmsLogRef = () => db().collection(COLLECTIONS.smsLogs).doc();

// ── offline referral queue ──────────────────────────────────────────────────
export const referralRequestRef = (id: string) => db().collection(COLLECTIONS.referralRequests).doc(id);
