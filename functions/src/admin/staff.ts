import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { z } from 'zod';
import type { CreateStaffUserRequest, CreateStaffUserResponse, SetStaffActiveRequest, SetStaffActiveResponse, StaffDoc } from '../shared/contracts';
import type { Role } from '../shared/types';
import { phMobile, staffPasswordSchema } from '../shared/schemas';
import { requireRole, requireStaff, type StaffContext } from '../lib/auth';
import { writeAudit } from '../lib/audit';
import { adminAuth } from '../lib/firebase';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { getClinic, getStaff, staffRef } from '../repositories';

const createSchema = z.object({
  name: z.string().trim().min(1, { message: 'Name is required.' }).max(120),
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }).max(200),
  contactNumber: phMobile,
  // clinic_admin is the clinic owner: granted only by registerClinic, never created from the Staff page.
  role: z.enum(['midwife', 'super_admin'], { message: 'Choose midwife or super admin.' }),
  clinicId: z.string().trim().min(1).max(64).nullable(),
  // Assigned by the clinic owner / super admin. Passed straight to Firebase Auth; never stored or logged here.
  password: staffPasswordSchema,
});

/** Pure permission check for staff creation (exported for tests). Returns an error message or null. */
export function staffCreationError(ctx: Pick<StaffContext, 'role' | 'clinicId'>, target: { role: Role; clinicId: string | null }): string | null {
  // The clinic owner (clinic_admin) is the person who registered the clinic; no one else can be made one.
  if (target.role === 'clinic_admin') return 'Each clinic has one owner: the person who registered it. Add staff as midwives.';
  if (target.role === 'super_admin' && target.clinicId !== null) return 'Super admins are not assigned to a clinic.';
  if (target.role !== 'super_admin' && !target.clinicId) return 'Select a clinic for this user.';
  if (ctx.role === 'super_admin') return null;
  if (ctx.role === 'clinic_admin') {
    if (target.role !== 'midwife') return 'Clinic admins can only create midwife accounts.';
    if (target.clinicId !== ctx.clinicId) return 'You can only add staff to your own clinic.';
    return null;
  }
  return MESSAGES.forbidden;
}

export const createStaffUser = onCall<CreateStaffUserRequest>(callableOptions(), async (request): Promise<CreateStaffUserResponse> => {
  try {
    const ctx = await requireStaff(request);
    requireRole(ctx, ['clinic_admin', 'super_admin']);
    const input = parseInput(createSchema, request.data);
    const problem = staffCreationError(ctx, input);
    if (problem) throw maraError('permission-denied', 'FORBIDDEN', problem);
    if (input.clinicId) {
      const clinic = await getClinic(input.clinicId);
      if (!clinic || clinic.active === false) throw maraError('failed-precondition', 'NOT_FOUND', 'Clinic not found or inactive.');
    }

    let uid: string;
    try {
      const user = await adminAuth().createUser({ email: input.email, password: input.password, displayName: input.name, disabled: false });
      uid = user.uid;
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/email-already-exists') throw maraError('already-exists', 'VALIDATION', 'An account with this email already exists.');
      if (code === 'auth/invalid-password') throw maraError('invalid-argument', 'VALIDATION', 'Use at least 8 characters for the password.');
      throw err;
    }

    try {
      await adminAuth().setCustomUserClaims(uid, { role: input.role, clinicId: input.clinicId });
      const now = Timestamp.now();
      const doc: StaffDoc = { uid, name: input.name, email: input.email, contactNumber: input.contactNumber, clinicId: input.clinicId, role: input.role, active: true, createdAt: now, updatedAt: now };
      await staffRef(uid).create(doc);
    } catch (err) {
      // Roll back the half-created auth user so the admin can retry cleanly.
      await adminAuth().deleteUser(uid).catch((e: unknown) => logger.error('Staff rollback failed', { message: e instanceof Error ? e.message : String(e) }));
      throw err;
    }

    await writeAudit({ action: 'staff_created', actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId: input.clinicId, patientId: null, referralId: null, details: { targetUid: uid, role: input.role } });
    return { uid };
  } catch (err) {
    throw toHttpsError(err, 'Unable to create the staff account. Please try again.');
  }
});

export const setStaffActive = onCall<SetStaffActiveRequest>(callableOptions(), async (request): Promise<SetStaffActiveResponse> => {
  try {
    const ctx = await requireStaff(request);
    requireRole(ctx, ['clinic_admin', 'super_admin']);
    const input = parseInput(z.object({ uid: z.string().trim().min(1).max(128), active: z.boolean() }), request.data);
    if (input.uid === ctx.uid) throw maraError('failed-precondition', 'FORBIDDEN', 'You cannot change your own account status.');
    const target = await getStaff(input.uid);
    if (!target) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
    if (ctx.role === 'clinic_admin' && (target.role !== 'midwife' || target.clinicId !== ctx.clinicId)) {
      throw maraError('permission-denied', 'FORBIDDEN', 'Clinic admins can only manage midwives in their own clinic.');
    }
    await staffRef(input.uid).update({ active: input.active, updatedAt: Timestamp.now() });
    await adminAuth().updateUser(input.uid, { disabled: !input.active });
    if (input.active) {
      // Restore role claims from the authoritative staff record.
      await adminAuth().setCustomUserClaims(input.uid, { role: target.role, clinicId: target.clinicId ?? null });
    } else {
      // Strip claims so any stale ID token loses its role at next refresh, then revoke sessions.
      await adminAuth().setCustomUserClaims(input.uid, {});
      await adminAuth().revokeRefreshTokens(input.uid);
    }
    await writeAudit({
      action: input.active ? 'staff_reactivated' : 'staff_deactivated',
      actorKind: 'user',
      actorUid: ctx.uid,
      actorRole: ctx.role,
      clinicId: target.clinicId,
      patientId: null,
      referralId: null,
      details: { targetUid: input.uid },
    });
    return { uid: input.uid, active: input.active };
  } catch (err) {
    throw toHttpsError(err, 'Unable to update the staff account. Please try again.');
  }
});
