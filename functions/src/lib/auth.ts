import type { CallableRequest } from 'firebase-functions/v2/https';
import type { Role } from '../shared/types';
import type { StaffDoc } from '../shared/contracts';
import { getStaff } from '../repositories';
import { MESSAGES, maraError } from './errors';

export interface StaffContext {
  uid: string;
  role: Role;
  clinicId: string | null;
  staff: StaffDoc;
}

const ROLES: Role[] = ['midwife', 'clinic_admin', 'super_admin'];

/** Reads { role, clinicId } custom claims from a decoded ID token. Pure; returns null if claims are missing/malformed. */
export function claimsFromToken(token: Record<string, unknown> | undefined): { role: Role; clinicId: string | null } | null {
  if (!token) return null;
  const role = token.role;
  const clinicId = token.clinicId;
  if (typeof role !== 'string' || !ROLES.includes(role as Role)) return null;
  if (role === 'super_admin') return { role, clinicId: null };
  if (typeof clinicId !== 'string' || clinicId.length === 0) return null;
  return { role: role as Role, clinicId };
}

/** Authenticates a staff caller from custom claims (never from client-supplied data) and checks the staff record is active. */
export async function requireStaff(request: Pick<CallableRequest<unknown>, 'auth'>): Promise<StaffContext> {
  const auth = request.auth;
  if (!auth?.uid) throw maraError('unauthenticated', 'FORBIDDEN', MESSAGES.unauthenticated);
  const claims = claimsFromToken(auth.token as unknown as Record<string, unknown>);
  if (!claims) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
  const staff = await getStaff(auth.uid);
  if (!staff || staff.active !== true) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.inactive);
  // Claims are authoritative; a mismatching staff doc means a stale/tampered state → deny.
  if (staff.role !== claims.role || (staff.clinicId ?? null) !== claims.clinicId) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
  return { uid: auth.uid, role: claims.role, clinicId: claims.clinicId, staff };
}

export function requireRole(ctx: StaffContext, roles: Role[]): void {
  if (!roles.includes(ctx.role)) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
}

/** Read/administer access to a clinic's records. super_admin may access any clinic. */
export function assertClinicAccess(ctx: Pick<StaffContext, 'role' | 'clinicId'>, clinicId: string): void {
  if (ctx.role === 'super_admin') return;
  if (!ctx.clinicId || ctx.clinicId !== clinicId) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
}

/**
 * Patient-record access (charts, referral contents, PDF exports): midwife/clinic_admin of that clinic only.
 * super_admin is deliberately excluded — it administers clinics/staff but has no patient-record access.
 */
export function assertClinicMember(ctx: Pick<StaffContext, 'role' | 'clinicId'>, clinicId: string): void {
  if (ctx.role !== 'midwife' && ctx.role !== 'clinic_admin') throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
  if (!ctx.clinicId || ctx.clinicId !== clinicId) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
}

/** Referral workflow actions (create/summary/send/cancel/resend) are limited to midwife/clinic_admin of that clinic. */
export function assertReferralWorker(ctx: Pick<StaffContext, 'role' | 'clinicId'>, clinicId: string): void {
  if (ctx.role !== 'midwife' && ctx.role !== 'clinic_admin') throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
  if (!ctx.clinicId || ctx.clinicId !== clinicId) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
}
