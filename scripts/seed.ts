/**
 * MARA demo seed — EMULATORS ONLY. All data is fictional.
 *
 *   npx tsx scripts/seed.ts --emulator
 *
 * Refuses to run unless FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are set
 * (the --emulator flag defaults them to 127.0.0.1:8080 / 127.0.0.1:9099). Idempotent: re-running
 * overwrites the same fixed ids.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type ClinicDoc, type HospitalDoc, type PatientDoc, type StaffDoc, type VisitDoc } from '../functions/src/shared/contracts';
import type { Role, VisitClinical } from '../functions/src/shared/types';

const PROJECT_ID = 'demo-mara';
const PASSWORD = 'Password123!'; // emulator only

if (process.argv.includes('--emulator')) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
}
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must be set (or pass --emulator). This script never targets production.');
  process.exit(1);
}
process.env.GCLOUD_PROJECT = PROJECT_ID;

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

const DAY = 86_400_000;
const MANILA = 8 * 3_600_000;
/** Today's date in Asia/Manila as a UTC-midnight millis value. */
const todayManila = Math.floor((Date.now() + MANILA) / DAY) * DAY;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const now = Timestamp.now();

// ── clinics ────────────────────────────────────────────────────────────────
const clinics: Record<string, Omit<ClinicDoc, 'createdAt' | 'updatedAt'>> = {
  'CLINIC-001': {
    name: 'Rosa Lying-In Clinic',
    address: '12 Sampaguita St., Poblacion',
    barangay: 'Poblacion',
    city: 'San Isidro',
    province: 'Demo Province',
    contactNumber: '09170000001',
    latitude: 14.5995,
    longitude: 121.0367,
    bhwContactNumber: '09170000002',
    mhoContactNumber: '09170000003',
    active: true,
  },
  'CLINIC-002': {
    name: 'Bayanihan Birthing Home',
    address: '45 Narra Ave., Mabini',
    barangay: 'Mabini',
    city: 'San Isidro',
    province: 'Demo Province',
    contactNumber: '09170000011',
    latitude: 14.6201,
    longitude: 121.0512,
    bhwContactNumber: null,
    mhoContactNumber: '09170000013',
    active: true,
  },
};

// ── hospitals ──────────────────────────────────────────────────────────────
const hospitals: Record<string, Omit<HospitalDoc, 'createdAt' | 'updatedAt'>> = {
  'HOSP-PROVINCIAL': {
    name: 'Provincial Hospital',
    address: '1 Capitol Rd., San Isidro',
    phone: '09170000101',
    referralLevel: 3,
    services: ['CEmONC', 'NICU', 'Emergency'],
    latitude: 14.6091,
    longitude: 121.0223,
    dohNetworked: true,
    active: true,
  },
  'HOSP-CITY-MATERNAL': {
    name: 'City Maternal Hospital',
    address: '88 Rizal Ave., San Isidro',
    phone: '(02) 8000 0102',
    referralLevel: 2,
    services: ['BEmONC', 'Emergency'],
    latitude: 14.5869,
    longitude: 121.0614,
    dohNetworked: true,
    active: true,
  },
  'HOSP-DISTRICT-ER': {
    name: 'District Emergency Hospital',
    address: '7 Mabini St., Santa Cruz',
    phone: '09170000103',
    referralLevel: 1,
    services: ['Emergency'],
    latitude: 14.6312,
    longitude: 121.0105,
    dohNetworked: false,
    active: true,
  },
};

// ── users ──────────────────────────────────────────────────────────────────
const users: { uid: string; email: string; name: string; role: Role; clinicId: string | null; contactNumber: string }[] = [
  { uid: 'seed-midwife-1', email: 'midwife@mara.test', name: 'Ana Reyes', role: 'midwife', clinicId: 'CLINIC-001', contactNumber: '09170000021' },
  { uid: 'seed-admin-1', email: 'admin@mara.test', name: 'Liza Cruz', role: 'clinic_admin', clinicId: 'CLINIC-001', contactNumber: '09170000022' },
  { uid: 'seed-super-1', email: 'super@mara.test', name: 'Demo Super Admin', role: 'super_admin', clinicId: null, contactNumber: '09170000023' },
  { uid: 'seed-midwife-2', email: 'midwife2@mara.test', name: 'Joy Santos', role: 'midwife', clinicId: 'CLINIC-002', contactNumber: '09170000031' },
];

async function upsertUser(u: (typeof users)[number]): Promise<void> {
  let uid = u.uid;
  try {
    const existing = await auth.getUserByEmail(u.email);
    uid = existing.uid;
    await auth.updateUser(uid, { password: PASSWORD, displayName: u.name, disabled: false, emailVerified: true });
  } catch {
    await auth.createUser({ uid, email: u.email, password: PASSWORD, displayName: u.name, emailVerified: true });
  }
  await auth.setCustomUserClaims(uid, { role: u.role, clinicId: u.clinicId });
  const doc: StaffDoc = { uid, name: u.name, email: u.email, contactNumber: u.contactNumber, clinicId: u.clinicId, role: u.role, active: true, createdAt: now, updatedAt: now };
  await db.collection(COLLECTIONS.midwives).doc(uid).set(doc);
}

// ── patient: Maria Santos, 30 weeks today ─────────────────────────────────
const PATIENT_ID = 'MARA-PAT-2841';
const lmpMs = todayManila - 30 * 7 * DAY;
const lmp = iso(lmpMs);
const edd = iso(lmpMs + 280 * DAY);
const midwife = users[0];

const noSigns = { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false };
const visitPlan: { week: number; v: Omit<VisitClinical, 'visitDate'> }[] = [
  { week: 16, v: { bpSystolic: 112, bpDiastolic: 72, weightKg: 57.5, fhr: 152, glucoseMgDl: 92, fundalHeightCm: 16, urineProtein: 'negative', urineGlucose: 'negative', medications: ['Ferrous sulfate + folic acid'], notes: 'Routine prenatal visit.', dangerSigns: noSigns } },
  { week: 20, v: { bpSystolic: 120, bpDiastolic: 78, weightKg: 59.5, fhr: 148, glucoseMgDl: 95, fundalHeightCm: 20, urineProtein: 'negative', urineGlucose: 'negative', medications: ['Ferrous sulfate + folic acid', 'Calcium carbonate'], notes: 'Routine prenatal visit.', dangerSigns: noSigns } },
  { week: 24, v: { bpSystolic: 138, bpDiastolic: 88, weightKg: 61.5, fhr: 146, glucoseMgDl: 101, fundalHeightCm: 24, urineProtein: 'trace', urineGlucose: 'negative', medications: ['Ferrous sulfate + folic acid', 'Calcium carbonate'], notes: 'Advised home BP monitoring.', dangerSigns: noSigns } },
  { week: 30, v: { bpSystolic: 155, bpDiastolic: 100, weightKg: 64, fhr: 143, glucoseMgDl: 104, fundalHeightCm: 29, urineProtein: '1+', urineGlucose: 'negative', medications: ['Ferrous sulfate + folic acid', 'Calcium carbonate'], notes: 'Reports headache since yesterday.', dangerSigns: { ...noSigns, severeHeadache: true } } },
];

async function main(): Promise<void> {
  for (const [id, c] of Object.entries(clinics)) await db.collection(COLLECTIONS.clinics).doc(id).set({ ...c, createdAt: now, updatedAt: now });
  for (const [id, h] of Object.entries(hospitals)) await db.collection(COLLECTIONS.hospitals).doc(id).set({ ...h, createdAt: now, updatedAt: now });
  for (const u of users) await upsertUser(u);

  // Clinic server codes (demo only). Staff join a clinic with their verified mobile number + this code.
  for (const [code, clinicId] of [['ROSA-2841', 'CLINIC-001'], ['LIGA-2026', 'CLINIC-002']] as const) {
    const old = await db.collection(COLLECTIONS.clinicJoinCodes).where('clinicId', '==', clinicId).get();
    for (const d of old.docs) if (d.id !== code) await d.ref.update({ active: false, revokedAt: now });
    await db.collection(COLLECTIONS.clinicJoinCodes).doc(code).set({ clinicId, active: true, createdAt: now, createdBy: 'seed', revokedAt: null });
  }

  const patient: PatientDoc = {
    patientId: PATIENT_ID,
    name: 'Maria Santos',
    nameLower: 'maria santos',
    birthdate: '1996-04-12',
    address: '23 Ilang-Ilang St., Poblacion',
    barangay: 'Poblacion',
    contactNumber: '09170000041',
    emergencyContact: { name: 'Jose Santos', relationship: 'Husband', contactNumber: '09170000042' },
    pregnancy: { lmp, edd, gravida: 3, para: 2 },
    allergies: ['Penicillin'],
    bloodType: 'O+',
    medicalHistory: ['No chronic illness documented'],
    obstetricHistory: ['2 term vaginal deliveries'],
    consent: { dataSharingForReferral: true, capturedAt: now, capturedBy: midwife.uid },
    clinicId: 'CLINIC-001',
    active: true,
    version: 1,
    createdAt: now,
    createdBy: midwife.uid,
    updatedAt: now,
    updatedBy: midwife.uid,
  };
  const patientRef = db.collection(COLLECTIONS.patients).doc(PATIENT_ID);
  await patientRef.set(patient);

  for (const { week, v } of visitPlan) {
    const visitDate = iso(lmpMs + week * 7 * DAY);
    const visitId = `${PATIENT_ID}-W${week}`;
    const at = Timestamp.fromMillis(Math.min(Date.now(), lmpMs + week * 7 * DAY + 2 * 3_600_000));
    const visit: VisitDoc = { ...v, visitDate, visitId, patientId: PATIENT_ID, clinicId: 'CLINIC-001', createdAt: at, createdBy: midwife.uid, createdByName: midwife.name, version: 1, updatedAt: at, updatedBy: midwife.uid };
    await patientRef.collection(COLLECTIONS.visits).doc(visitId).set(visit);
  }

  console.log(`Seeded project ${PROJECT_ID}: 2 clinics (server codes ROSA-2841, LIGA-2026), 3 hospitals, ${users.length} users (password ${PASSWORD}), patient ${PATIENT_ID} (LMP ${lmp}, 30 weeks today) with ${visitPlan.length} visits.`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error('Seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
