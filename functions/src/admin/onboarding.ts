// Clinic registration (the only self-service sign-up):
//  - registerClinic: a new email/password user registers a clinic and becomes its owner (clinic_admin).
// Staff never self-register: the clinic owner (or a super admin) creates staff accounts with createStaffUser.
// Roles are only ever granted server-side (custom claims), never by the client.
import { Timestamp } from 'firebase-admin/firestore';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { type ClinicDoc, type RegisterClinicRequest, type RegisterClinicResponse, type StaffDoc } from '../shared/contracts';
import { clinicRegistrationSchema } from '../shared/schemas';
import { newClinicId } from '../shared/ids';
import { claimsFromToken } from '../lib/auth';
import { auditInTx } from '../lib/audit';
import { adminAuth, db } from '../lib/firebase';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { REGISTER_CLINIC_LIMIT_PER_MINUTE, clientIp, consumeRateLimit } from '../lib/rateLimit';
import { clinicRef, getStaff, staffRef } from '../repositories';

const ALREADY_MEMBER = 'This account already belongs to a clinic. Sign in to open your dashboard.';

/** Signed-in Firebase user that has no MARA role yet. Returns uid + raw token. */
function requireUnassignedUser(request: Pick<CallableRequest<unknown>, 'auth'>) {
  const auth = request.auth;
  if (!auth?.uid) throw maraError('unauthenticated', 'FORBIDDEN', MESSAGES.unauthenticated);
  const token = auth.token as unknown as Record<string, unknown>;
  return { uid: auth.uid, token, hasRole: claimsFromToken(token) !== null };
}

/**
 * Repairs a half-finished registration (Firestore committed, claims call failed): if the caller already has an active
 * staff profile but no claims, re-apply the claims from the profile. Returns the profile, or null if there is none.
 */
async function repairClaims(uid: string, hasRole: boolean): Promise<StaffDoc | null> {
  const staff = await getStaff(uid);
  if (!staff) return null;
  if (hasRole || staff.active !== true) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);
  await adminAuth().setCustomUserClaims(uid, { role: staff.role, clinicId: staff.clinicId ?? null });
  return staff;
}

export const registerClinic = onCall<RegisterClinicRequest>(callableOptions(), async (request): Promise<RegisterClinicResponse> => {
  try {
    const { uid, token, hasRole } = requireUnassignedUser(request);
    const email = typeof token.email === 'string' ? token.email.toLowerCase() : '';
    if (!email) throw maraError('failed-precondition', 'VALIDATION', 'Create the owner account with an email address first.');
    const input = parseInput(clinicRegistrationSchema, request.data);

    const repaired = await repairClaims(uid, hasRole);
    if (repaired?.clinicId) return { clinicId: repaired.clinicId };
    if (hasRole) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);

    const ip = clientIp(request.rawRequest as unknown as { ip?: string; headers?: Record<string, string | string[] | undefined> });
    if (!(await consumeRateLimit(ip, 'register_clinic', REGISTER_CLINIC_LIMIT_PER_MINUTE))) {
      throw maraError('resource-exhausted', 'FORBIDDEN', MESSAGES.rateLimited);
    }

    const clinicId = newClinicId();
    await db().runTransaction(async (tx) => {
      if ((await tx.get(staffRef(uid))).exists) throw maraError('already-exists', 'VALIDATION', ALREADY_MEMBER);
      if ((await tx.get(clinicRef(clinicId))).exists) throw new Error('Clinic id collision');
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
      auditInTx(tx, { action: 'clinic_registered', actorKind: 'user', actorUid: uid, actorRole: 'clinic_admin', clinicId, patientId: null, referralId: null, details: {} });
    });

    await adminAuth().setCustomUserClaims(uid, { role: 'clinic_admin', clinicId });
    await adminAuth().updateUser(uid, { displayName: input.adminName }).catch(() => undefined);
    return { clinicId };
  } catch (err) {
    throw toHttpsError(err, 'Unable to register the clinic. Please try again.');
  }
});
