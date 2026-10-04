import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export type Db = firebase.firestore.Firestore;

export const PROJECT_ID = 'demo-mara';

export const serverTs = () => firebase.firestore.FieldValue.serverTimestamp();
export const fixedTs = () => firebase.firestore.Timestamp.fromMillis(Date.UTC(2025, 0, 1));

export async function setupEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

// ── Actors ────────────────────────────────────────────────────────────────────

export const CLINIC_A = 'clinic-a';
export const CLINIC_B = 'clinic-b';

export const USERS = {
  midwifeA: { uid: 'mw-a', claims: { role: 'midwife', clinicId: CLINIC_A } },
  adminA: { uid: 'admin-a', claims: { role: 'clinic_admin', clinicId: CLINIC_A } },
  midwifeB: { uid: 'mw-b', claims: { role: 'midwife', clinicId: CLINIC_B } },
  adminB: { uid: 'admin-b', claims: { role: 'clinic_admin', clinicId: CLINIC_B } },
  // Deactivated midwife whose ID token still carries valid claims (pre-expiry window).
  inactiveMidwifeA: { uid: 'mw-a-off', claims: { role: 'midwife', clinicId: CLINIC_A } },
  // Valid claims but no midwives/{uid} profile at all.
  ghostMidwifeA: { uid: 'mw-a-ghost', claims: { role: 'midwife', clinicId: CLINIC_A } },
  superAdmin: { uid: 'super-1', claims: { role: 'super_admin', clinicId: null } },
  noClaims: { uid: 'rando', claims: {} },
} as const;

export type UserKey = keyof typeof USERS;

export function dbAs(env: RulesTestEnvironment, who: UserKey | 'anon'): Db {
  if (who === 'anon') return env.unauthenticatedContext().firestore();
  const u = USERS[who];
  return env.authenticatedContext(u.uid, { ...u.claims } as Record<string, unknown>).firestore();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const PATIENT_A = 'MARA-PAT-A001';
export const PATIENT_B = 'MARA-PAT-B001';
export const VISIT_A = 'visit-a-1';
export const VISIT_B = 'visit-b-1';
export const REQUEST_ID = '0b7c6d1e-3f4a-4b5c-8d9e-0f1a2b3c4d5e';

type Ts = firebase.firestore.Timestamp | firebase.firestore.FieldValue;

export function clinicDoc(ts: Ts = fixedTs()) {
  return {
    name: 'Clinic',
    address: 'Address',
    barangay: 'Brgy',
    city: 'City',
    province: 'Province',
    contactNumber: '09171234567',
    latitude: 14.6,
    longitude: 121.0,
    bhwContactNumber: null,
    mhoContactNumber: null,
    active: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function hospitalDoc(ts: Ts = fixedTs()) {
  return {
    name: 'Provincial Hospital',
    address: 'Hospital Road',
    phone: '(02) 8123 4567',
    referralLevel: 2,
    services: ['CEmONC', 'Emergency'],
    latitude: 14.65,
    longitude: 121.05,
    dohNetworked: true,
    active: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function patientDoc(opts: { patientId: string; clinicId: string; uid: string; ts?: Ts; version?: number }) {
  const ts = opts.ts ?? fixedTs();
  return {
    patientId: opts.patientId,
    name: 'Test Patient',
    nameLower: 'test patient',
    birthdate: '1995-05-05',
    address: '123 Street',
    barangay: 'Brgy Uno',
    contactNumber: '09171234567',
    emergencyContact: { name: 'Contact Person', relationship: 'Spouse', contactNumber: '09181234567' },
    pregnancy: { lmp: '2025-01-01', edd: '2025-10-08', gravida: 2, para: 1 },
    allergies: [],
    bloodType: 'O+',
    medicalHistory: [],
    obstetricHistory: [],
    consent: { dataSharingForReferral: true, capturedAt: ts, capturedBy: opts.uid },
    clinicId: opts.clinicId,
    active: true,
    version: opts.version ?? 1,
    createdAt: ts,
    createdBy: opts.uid,
    updatedAt: ts,
    updatedBy: opts.uid,
  };
}

export function visitDoc(opts: { visitId: string; patientId: string; clinicId: string; uid: string; ts?: Ts; version?: number }) {
  const ts = opts.ts ?? fixedTs();
  return {
    visitId: opts.visitId,
    patientId: opts.patientId,
    clinicId: opts.clinicId,
    visitDate: '2025-03-01',
    bpSystolic: 120,
    bpDiastolic: 80,
    weightKg: 60,
    fhr: 140,
    glucoseMgDl: null,
    fundalHeightCm: 20,
    urineProtein: 'negative',
    urineGlucose: 'negative',
    medications: ['Ferrous sulfate'],
    notes: '',
    dangerSigns: { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false },
    createdAt: ts,
    createdBy: opts.uid,
    createdByName: 'Midwife',
    version: opts.version ?? 1,
    updatedAt: ts,
    updatedBy: opts.uid,
  };
}

export function auditDoc(overrides: Record<string, unknown> = {}) {
  return {
    action: 'patient_viewed',
    actorKind: 'user',
    actorUid: USERS.midwifeA.uid,
    actorRole: 'midwife',
    clinicId: CLINIC_A,
    patientId: PATIENT_A,
    referralId: null,
    at: serverTs(),
    details: {},
    ...overrides,
  };
}

export function referralRequestDoc(overrides: Record<string, unknown> = {}) {
  return {
    patientId: PATIENT_A,
    hospitalId: 'hosp-1',
    reasonCode: 'severe_bleeding',
    reasonText: '',
    clientRequestId: REQUEST_ID,
    type: 'emergency',
    clinicId: CLINIC_A,
    createdBy: USERS.midwifeA.uid,
    createdAt: serverTs(),
    state: 'queued',
    referralId: null,
    error: null,
    processedAt: null,
    ...overrides,
  };
}

/** Seeds one record per collection for clinic A and clinic B with rules disabled. */
export async function seed(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const writes: Promise<unknown>[] = [];
    for (const [cid, pid, vid, mw] of [
      [CLINIC_A, PATIENT_A, VISIT_A, USERS.midwifeA.uid],
      [CLINIC_B, PATIENT_B, VISIT_B, USERS.midwifeB.uid],
    ] as const) {
      writes.push(db.doc(`clinics/${cid}`).set(clinicDoc()));
      writes.push(db.doc(`patients/${pid}`).set(patientDoc({ patientId: pid, clinicId: cid, uid: mw })));
      writes.push(db.doc(`patients/${pid}/visits/${vid}`).set(visitDoc({ visitId: vid, patientId: pid, clinicId: cid, uid: mw })));

      writes.push(db.doc(`referrals/ref-${cid}`).set({ referralId: `ref-${cid}`, clinicId: cid, patientId: pid, patientName: 'Test Patient', status: 'SENT' }));
      writes.push(db.doc(`smsLogs/sms-${cid}`).set({ clinicId: cid, referralId: `ref-${cid}`, status: 'sent', message: 'MARA referral link' }));
      writes.push(db.doc(`auditLogs/log-${cid}`).set({ action: 'referral_sent', actorKind: 'system', actorUid: null, actorRole: null, clinicId: cid, patientId: pid, referralId: `ref-${cid}`, at: fixedTs(), details: {} }));
      writes.push(db.doc(`referralTokens/hash-${cid}`).set({ referralId: `ref-${cid}`, clinicId: cid, revoked: false }));
    }
    // Active staff profiles for every writing test user (rules require isActiveStaff() on writes).
    for (const key of ['midwifeA', 'adminA', 'midwifeB', 'adminB', 'superAdmin', 'inactiveMidwifeA'] as const) {
      const u = USERS[key];
      writes.push(
        db.doc(`midwives/${u.uid}`).set({
          uid: u.uid,
          name: key,
          email: `${u.uid}@example.test`,
          contactNumber: '09171234567',
          clinicId: u.claims.clinicId,
          role: u.claims.role,
          active: key !== 'inactiveMidwifeA',
        }),
      );
    }
    writes.push(db.doc('hospitals/hosp-1').set(hospitalDoc()));
    writes.push(db.doc('rateLimits/ip-1').set({ count: 1 }));
    await Promise.all(writes);
  });
}
