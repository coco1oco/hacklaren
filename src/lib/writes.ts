// All client-side Firestore writes for patients, visits, and the offline emergency queue.
// Writes are never awaited by the UI (offline-first). Every write is first persisted in the durable outbox
// (see outbox.ts); rejections, including ones that happen after a reload, end up as sync conflicts.
import { doc, getDocFromServer, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, type PatientDoc } from '@shared/contracts';
import type { PatientInput, EmergencyReferralInput, VisitClinicalInput } from '@shared/schemas';
import type { Role } from '@shared/types';
import { db } from './firebase';
import { normalizeName } from './format';
import { trackOutboxWrite } from './outbox';
import type { SyncConflict } from './syncConflicts';

export interface WriteCtx {
  uid: string;
  role: Role;
  clinicId: string;
  staffName: string;
}

type Plain = Record<string, unknown>;

function patientFields(input: PatientInput): Plain {
  return {
    name: input.name.trim(),
    nameLower: normalizeName(input.name),
    birthdate: input.birthdate,
    address: input.address,
    barangay: input.barangay,
    contactNumber: input.contactNumber,
    emergencyContact: input.emergencyContact,
    pregnancy: input.pregnancy,
    allergies: input.allergies,
    bloodType: input.bloodType,
    medicalHistory: input.medicalHistory,
    obstetricHistory: input.obstetricHistory,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function writePatientCreate(uid: string, payload: Plain): void {
  const patientId = String(payload.patientId);
  const consent = payload.consent as Plain;
  trackOutboxWrite(uid, { kind: 'patient_create', docPath: `${COLLECTIONS.patients}/${patientId}`, patientId, label: `New patient: ${String(payload.name)}`, payload }, () =>
    setDoc(doc(db, COLLECTIONS.patients, patientId), {
      ...payload,
      consent: { ...consent, capturedAt: serverTimestamp() },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
}

export function createPatient(ctx: WriteCtx, patientId: string, input: PatientInput): void {
  writePatientCreate(ctx.uid, {
    ...patientFields(input),
    patientId,
    consent: { dataSharingForReferral: input.consentGiven, capturedBy: ctx.uid },
    clinicId: ctx.clinicId,
    active: true,
    version: 1,
    createdBy: ctx.uid,
    updatedBy: ctx.uid,
  });
}

/**
 * `changes` holds only the changed fields; `base` their previous values (for the conflict view).
 * Consent changes carry `{ dataSharingForReferral }`; capturedBy/capturedAt are set here (rules require uid + request.time).
 */
function writePatientUpdate(ctx: WriteCtx, patientId: string, changes: Plain, base: Plain, baseVersion: number): void {
  const data: Plain = { ...changes, version: baseVersion + 1, updatedAt: serverTimestamp(), updatedBy: ctx.uid };
  if (changes.consent) {
    data.consent = { dataSharingForReferral: Boolean((changes.consent as Plain).dataSharingForReferral), capturedBy: ctx.uid, capturedAt: serverTimestamp() };
  }
  trackOutboxWrite(
    ctx.uid,
    {
      kind: 'patient_update',
      docPath: `${COLLECTIONS.patients}/${patientId}`,
      patientId,
      label: `Edit to patient ${String(changes.name ?? base.name ?? patientId)}`,
      payload: changes,
      base,
      baseVersion,
    },
    () => updateDoc(doc(db, COLLECTIONS.patients, patientId), data),
  );
}

/** Field-level diff of a patient form against the record it was opened from. Exported for tests. */
export function diffPatient(patient: PatientDoc, input: PatientInput): { changes: Plain; base: Plain } {
  const next = patientFields(input);
  const prev = patient as unknown as Plain;
  const changes: Plain = {};
  const base: Plain = { name: patient.name };
  for (const [k, v] of Object.entries(next)) {
    if (!same(prev[k], v)) {
      changes[k] = v;
      base[k] = prev[k] ?? null;
    }
  }
  if (input.consentGiven !== patient.consent?.dataSharingForReferral) {
    changes.consent = { dataSharingForReferral: input.consentGiven };
    base.consent = { dataSharingForReferral: patient.consent?.dataSharingForReferral ?? false };
  }
  return { changes, base };
}

/**
 * Optimistic concurrency: version must be previous + 1 (enforced by rules). Only changed fields are written,
 * so a concurrent edit to other fields is never overwritten. Returns false if nothing changed.
 */
export function updatePatient(ctx: WriteCtx, patient: PatientDoc, input: PatientInput): boolean {
  const { changes, base } = diffPatient(patient, input);
  if (!Object.keys(changes).length) return false;
  writePatientUpdate(ctx, patient.patientId, changes, base, patient.version ?? 0);
  return true;
}

function writeVisitCreate(uid: string, payload: Plain): void {
  const path = `${COLLECTIONS.patients}/${String(payload.patientId)}/${COLLECTIONS.visits}/${String(payload.visitId)}`;
  trackOutboxWrite(uid, { kind: 'visit_create', docPath: path, patientId: String(payload.patientId), label: `Visit on ${String(payload.visitDate)}`, payload }, () =>
    setDoc(doc(db, path), { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
  );
}

/** Firestore rejects `undefined`, so optional measurements are normalised to null. */
export function createVisit(ctx: WriteCtx, patientId: string, input: VisitClinicalInput): string {
  const visitId = crypto.randomUUID();
  writeVisitCreate(ctx.uid, {
    visitDate: input.visitDate,
    bpSystolic: input.bpSystolic,
    bpDiastolic: input.bpDiastolic,
    weightKg: input.weightKg,
    fhr: input.fhr ?? null,
    glucoseMgDl: input.glucoseMgDl ?? null,
    fundalHeightCm: input.fundalHeightCm ?? null,
    urineProtein: input.urineProtein,
    urineGlucose: input.urineGlucose,
    medications: input.medications,
    notes: input.notes,
    dangerSigns: input.dangerSigns,
    visitId,
    patientId,
    clinicId: ctx.clinicId,
    createdBy: ctx.uid,
    createdByName: ctx.staffName,
    version: 1,
    updatedBy: ctx.uid,
  });
  return visitId;
}

function writeReferralRequest(uid: string, payload: Plain): void {
  const id = String(payload.clientRequestId);
  trackOutboxWrite(
    uid,
    { kind: 'referral_request', docPath: `${COLLECTIONS.referralRequests}/${id}`, patientId: String(payload.patientId), label: 'Queued emergency referral', payload },
    () => setDoc(doc(db, COLLECTIONS.referralRequests, id), { ...payload, createdAt: serverTimestamp() }),
  );
}

/** Offline emergency queue. A server trigger turns this into a referral once it syncs. */
export function queueEmergencyRequest(ctx: WriteCtx, input: EmergencyReferralInput): void {
  writeReferralRequest(ctx.uid, {
    ...input,
    type: 'emergency',
    clinicId: ctx.clinicId,
    createdBy: ctx.uid,
    state: 'queued',
    referralId: null,
    error: null,
    processedAt: null,
  });
}

/** "Re-apply as new edit": re-sends a rejected payload on top of the latest server state. */
export async function reapplyConflict(ctx: WriteCtx, c: SyncConflict): Promise<void> {
  switch (c.kind) {
    case 'patient_create': {
      const consent = (c.payload.consent as Plain | undefined) ?? {};
      writePatientCreate(ctx.uid, { ...c.payload, consent: { ...consent, capturedBy: ctx.uid }, createdBy: ctx.uid, updatedBy: ctx.uid });
      return;
    }
    case 'patient_update': {
      // Only the fields the midwife changed are written, on top of the CURRENT server doc (version = server + 1).
      const snap = await getDocFromServer(doc(db, c.docPath));
      if (!snap.exists()) throw new Error('Patient record not found.');
      const server = snap.data() as Plain;
      const base: Plain = { name: server.name };
      for (const k of Object.keys(c.payload)) {
        base[k] = k === 'consent' ? { dataSharingForReferral: (server.consent as Plain | undefined)?.dataSharingForReferral ?? false } : (server[k] ?? null);
      }
      writePatientUpdate(ctx, snap.id, c.payload, base, Number(server.version ?? 0));
      return;
    }
    case 'visit_create':
      // New id so a partially-existing doc cannot block the re-apply.
      writeVisitCreate(ctx.uid, { ...c.payload, visitId: crypto.randomUUID(), createdBy: ctx.uid, createdByName: ctx.staffName, updatedBy: ctx.uid, version: 1 });
      return;
    case 'referral_request':
      // Same clientRequestId keeps it idempotent on the server.
      writeReferralRequest(ctx.uid, c.payload);
      return;
  }
}
