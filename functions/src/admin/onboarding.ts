// Self-service onboarding:
//  - registerClinic: a new email/password user registers a clinic and becomes its clinic_admin.
//  - joinClinic: a phone-verified user enters the clinic's server code and becomes a midwife of that clinic.
//  - getClinicJoinCode / rotateClinicJoinCode: clinic admins view or replace their clinic's server code.
// Roles are only ever granted here (server-side custom claims), never by the client.
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { z } from 'zod';
import {
  COLLECTIONS,
  type ClinicDoc,
  type ClinicJoinCodeDoc,
  type ClinicJoinCodeRequest,
  type ClinicJoinCodeResponse,
  type JoinClinicRequest,
  type JoinClinicResponse,
  type RegisterClinicRequest,
  type RegisterClinicResponse,
  type StaffDoc,
} from '../shared/contracts';
import { clinicRegistrationSchema, joinClinicSchema } from '../shared/schemas';
import { newClinicId, newJoinCode } from '../shared/ids';
import { claimsFromToken, requireRole, requireStaff } from '../lib/auth';
import { auditInTx, writeAudit } from '../lib/audit';
import { adminAuth, db } from '../lib/firebase';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { JOIN_CODE_LIMIT_PER_MINUTE, REGISTER_CLINIC_LIMIT_PER_MINUTE, clientIp, consumeRateLimit, isOverLimit } from '../lib/rateLimit';
import { clinicRef, getClinic, getStaff, staffRef } from '../repositories';
import { normalizePhMobile } from '../services/sms/messages';

const joinCodeRef = (code: string) => db().collection(COLLECTIONS.clinicJoinCodes).doc(code);

const ALREADY_MEMBER = 'This account already belongs to a clinic. Sign in to open your dashboard.';
const BAD_CODE = 'That server code is not valid. Check the code with your clinic administrator.';

/** Signed-in Firebase user that has no MARA role yet. Returns uid + raw token. */
function requireUnassignedUser(request: Pick<CallableRequest<unknown>, 'auth'>) {
  const auth = request.auth;
  if (!auth?.uid) throw maraError('unauthenticated', 'FORBIDDEN', MESSAGES.unauthenticated);
  const token = auth.token as unknown as Record<string, unknown>;
  return { uid: auth.uid, token, hasRole: claimsFromToken(token) !== null };
}

/** Creates a fresh, unused active join code for a clinic inside a transaction. Reads must happen before writes. */
async function reserveJoinCode(tx: Transaction): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newJoinCode();
    if (!(await tx.get(joinCodeRef(code))).exists) return code;
  }
  throw new Error('Could not allocate a unique join code');
}

function joinCodeDoc(clinicId: string, createdBy: string, now: Timestamp): ClinicJoinCodeDoc {
  return { clinicId, active: true, createdAt: now, createdBy, revokedAt: null };
}

async function activeJoinCode(clinicId: string): Promise<{ code: string; doc: ClinicJoinCodeDoc } | null> {
  const snap = await db().collection(COLLECTIONS.clinicJoinCodes).where('clinicId', '==', clinicId).where('active', '==', true).limit(1).get();
  return snap.empty ? null : { code: snap.docs[0].id, doc: snap.docs[0].data() as ClinicJoinCodeDoc };
}

/**
 * Repairs a half-finished onboarding (Firestore committed, claims call failed): if the caller already has an active
 * staff profile but no claims, re-apply the claims from the profile. Returns the profile, or null if there is none.
 */
async function repairClaims(uid: string, hasRole: boolean): Promise<StaffDoc | null> {
  const staff = await getStaff(uid);
  if (!staff) return null;
  if (hasRole || staff.active !== true) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);
  await adminAuth().setCustomUserClaims(uid, { role: staff.role, clinicId: staff.clinicId ?? null });
  return staff;
}

// ─────────────────────────────────────────────────────────────────────────────

export const registerClinic = onCall<RegisterClinicRequest>(callableOptions(), async (request): Promise<RegisterClinicResponse> => {
  try {
    const { uid, token, hasRole } = requireUnassignedUser(request);
    const email = typeof token.email === 'string' ? token.email.toLowerCase() : '';
    if (!email) throw maraError('failed-precondition', 'VALIDATION', 'Create the administrator account with an email address first.');
    const input = parseInput(clinicRegistrationSchema, request.data);

    const repaired = await repairClaims(uid, hasRole);
    if (repaired?.clinicId) {
      const code = (await activeJoinCode(repaired.clinicId))?.code ?? '';
      return { clinicId: repaired.clinicId, joinCode: code };
    }
    if (hasRole) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);

    const ip = clientIp(request.rawRequest as unknown as { ip?: string; headers?: Record<string, string | string[] | undefined> });
    if (!(await consumeRateLimit(ip, 'register_clinic', REGISTER_CLINIC_LIMIT_PER_MINUTE))) {
      throw maraError('resource-exhausted', 'FORBIDDEN', MESSAGES.rateLimited);
    }

    const clinicId = newClinicId();
    const joinCode = await db().runTransaction(async (tx) => {
      if ((await tx.get(staffRef(uid))).exists) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);
      if ((await tx.get(clinicRef(clinicId))).exists) throw new Error('Clinic id collision');
      const code = await reserveJoinCode(tx);
      const now = Timestamp.now();
      const clinic: ClinicDoc = {
        ...input.clinic,
        latitude: null,
        longitude: null,
        bhwContactNumber: null,
        mhoContactNumber: null,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      const staff: StaffDoc = { uid, name: input.adminName, email, contactNumber: input.adminContactNumber, clinicId, role: 'clinic_admin', active: true, createdAt: now, updatedAt: now };
      tx.create(clinicRef(clinicId), clinic);
      tx.create(staffRef(uid), staff);
      tx.create(joinCodeRef(code), joinCodeDoc(clinicId, uid, now));
      auditInTx(tx, { action: 'clinic_registered', actorKind: 'user', actorUid: uid, actorRole: 'clinic_admin', clinicId, patientId: null, referralId: null, details: {} });
      return code;
    });

    await adminAuth().setCustomUserClaims(uid, { role: 'clinic_admin', clinicId });
    if (input.adminName) await adminAuth().updateUser(uid, { displayName: input.adminName }).catch(() => undefined);
    return { clinicId, joinCode };
  } catch (err) {
    throw toHttpsError(err, 'Unable to register the clinic. Please try again.');
  }
});

export const joinClinic = onCall<JoinClinicRequest>(callableOptions(), async (request): Promise<JoinClinicResponse> => {
  try {
    const { uid, token, hasRole } = requireUnassignedUser(request);
    // The phone number comes from Firebase Phone Auth (OTP-verified), never from client input.
    const phone = typeof token.phone_number === 'string' ? normalizePhMobile(token.phone_number) : null;
    if (!phone) throw maraError('failed-precondition', 'VALIDATION', 'Verify your Philippine mobile number first.');

    const repaired = await repairClaims(uid, hasRole);
    if (repaired?.clinicId) {
      const clinic = await getClinic(repaired.clinicId);
      return { clinicId: repaired.clinicId, clinicName: clinic?.name ?? '' };
    }
    if (hasRole) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);

    // Brute-force protection: wrong codes are counted per user; checked before any lookup.
    const limiterKey = `uid:${uid}`;
    if (await isOverLimit(limiterKey, 'join_code', JOIN_CODE_LIMIT_PER_MINUTE)) throw maraError('resource-exhausted', 'FORBIDDEN', MESSAGES.rateLimited);

    const input = parseInput(joinClinicSchema, request.data);
    const fail = async () => {
      await consumeRateLimit(limiterKey, 'join_code', JOIN_CODE_LIMIT_PER_MINUTE);
      await writeAudit({ action: 'join_code_failed', actorKind: 'user', actorUid: uid, actorRole: null, clinicId: null, patientId: null, referralId: null, details: {} });
      return maraError('permission-denied', 'FORBIDDEN', BAD_CODE);
    };

    const result = await db().runTransaction(async (tx) => {
      const codeSnap = await tx.get(joinCodeRef(input.code));
      const code = codeSnap.exists ? (codeSnap.data() as ClinicJoinCodeDoc) : null;
      if (!code || code.active !== true) return null;
      const clinic = await getClinic(code.clinicId, tx);
      if (!clinic || clinic.active !== true) return null;
      if ((await tx.get(staffRef(uid))).exists) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);
      const now = Timestamp.now();
      const staff: StaffDoc = { uid, name: input.name, email: '', contactNumber: phone, clinicId: code.clinicId, role: 'midwife', active: true, createdAt: now, updatedAt: now };
      tx.create(staffRef(uid), staff);
      auditInTx(tx, { action: 'staff_joined', actorKind: 'user', actorUid: uid, actorRole: 'midwife', clinicId: code.clinicId, patientId: null, referralId: null, details: {} });
      return { clinicId: code.clinicId, clinicName: clinic.name };
    });
    if (!result) throw await fail();

    await adminAuth().setCustomUserClaims(uid, { role: 'midwife', clinicId: result.clinicId });
    await adminAuth().updateUser(uid, { displayName: input.name }).catch(() => undefined);
    return result;
  } catch (err) {
    throw toHttpsError(err, 'Unable to join the clinic. Please try again.');
  }
});

const codeRequestSchema = z.object({ clinicId: z.string().trim().min(1).max(64).nullable() });

async function targetClinic(request: CallableRequest<ClinicJoinCodeRequest>) {
  const ctx = await requireStaff(request);
  requireRole(ctx, ['clinic_admin', 'super_admin']);
  const input = parseInput(codeRequestSchema, request.data ?? { clinicId: null });
  const clinicId = ctx.role === 'clinic_admin' ? ctx.clinicId : input.clinicId;
  if (!clinicId) throw maraError('invalid-argument', 'VALIDATION', 'Select a clinic.');
  const clinic = await getClinic(clinicId);
  if (!clinic) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
  return { ctx, clinicId };
}

/** Issues a new active code, deactivating any previous ones (atomic). */
async function issueCode(clinicId: string, uid: string): Promise<ClinicJoinCodeResponse> {
  const previous = await db().collection(COLLECTIONS.clinicJoinCodes).where('clinicId', '==', clinicId).where('active', '==', true).get();
  return db().runTransaction(async (tx) => {
    const code = await reserveJoinCode(tx);
    const now = Timestamp.now();
    for (const d of previous.docs) tx.update(d.ref, { active: false, revokedAt: now });
    tx.create(joinCodeRef(code), joinCodeDoc(clinicId, uid, now));
    return { code, createdAtMillis: now.toMillis() };
  });
}

export const getClinicJoinCode = onCall<ClinicJoinCodeRequest>(callableOptions(), async (request): Promise<ClinicJoinCodeResponse> => {
  try {
    const { ctx, clinicId } = await targetClinic(request);
    const existing = await activeJoinCode(clinicId);
    if (existing) return { code: existing.code, createdAtMillis: existing.doc.createdAt.toMillis() };
    // Clinics created before self-service onboarding get a code on first request.
    return await issueCode(clinicId, ctx.uid);
  } catch (err) {
    throw toHttpsError(err, 'Unable to load the clinic server code. Please try again.');
  }
});

export const rotateClinicJoinCode = onCall<ClinicJoinCodeRequest>(callableOptions(), async (request): Promise<ClinicJoinCodeResponse> => {
  try {
    const { ctx, clinicId } = await targetClinic(request);
    const result = await issueCode(clinicId, ctx.uid);
    await writeAudit({ action: 'join_code_rotated', actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId, patientId: null, referralId: null, details: {} });
    logger.info('Clinic join code rotated', { clinicId });
    return result;
  } catch (err) {
    throw toHttpsError(err, 'Unable to generate a new server code. Please try again.');
  }
});
