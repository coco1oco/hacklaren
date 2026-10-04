import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { COLLECTIONS, type MaraClaims, type StaffDoc } from '@shared/contracts';
import type { Role } from '@shared/types';
import { auth, db } from '@/lib/firebase';
import { hardLogout } from '@/lib/session';
import type { WriteCtx } from '@/lib/writes';

const ROLES: Role[] = ['midwife', 'clinic_admin', 'super_admin'];

function decodeCachedClaims(user: User): Record<string, unknown> | null {
  const token = (user as unknown as { accessToken?: string }).accessToken;
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface AuthValue {
  /**
   * 'unassigned' = signed in to Firebase but not yet a member of any clinic (new clinic sign-up in progress,
   * or a verified mobile number that has not entered a clinic server code yet). No clinical access.
   */
  status: 'loading' | 'signedOut' | 'unassigned' | 'signedIn';
  user: User | null;
  /** From the verified ID token (custom claims). Never from Firestore or local state. */
  claims: MaraClaims | null;
  staff: StaffDoc | null;
  /** Write context for clinic-scoped writes; null for super_admin (no clinic). */
  ctx: WriteCtx | null;
  /** Staff profile says active === false. SessionGuard locks or logs out. */
  deactivated: boolean;
}

const AuthContext = createContext<AuthValue>({ status: 'loading', user: null, claims: null, staff: null, ctx: null, deactivated: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<Pick<AuthValue, 'status' | 'user' | 'claims'>>({ status: 'loading', user: null, claims: null });
  const [staff, setStaff] = useState<StaffDoc | null>(null);

  useEffect(
    () =>
      // onIdTokenChanged (not onAuthStateChanged) so a forced token refresh after onboarding picks up new claims.
      onIdTokenChanged(auth, async (user) => {
        if (!user) {
          setBase({ status: 'signedOut', user: null, claims: null });
          return;
        }
        let raw: Record<string, unknown> | null;
        try {
          raw = (await user.getIdTokenResult()).claims;
        } catch {
          // Offline with an expired token: fall back to the cached token's claims for UI routing only.
          // Firestore rules and Cloud Functions still verify claims server-side before any data is accepted.
          raw = decodeCachedClaims(user);
        }
        const role = raw?.role as Role | undefined;
        const clinicId = (raw?.clinicId as string | null | undefined) ?? null;
        if (!raw) {
          setBase({ status: 'signedOut', user: null, claims: null });
          return;
        }
        if (role && !ROLES.includes(role)) {
          await hardLogout('Your account does not have access to MARA. Please contact your administrator.');
          return;
        }
        if (!role || (role !== 'super_admin' && !clinicId)) {
          // Not a clinic member yet: route to clinic sign-up (email accounts) or server-code entry (mobile accounts).
          setBase({ status: 'unassigned', user, claims: null });
          return;
        }
        setBase({ status: 'signedIn', user, claims: { role, clinicId } });
      }),
    [],
  );

  const uid = base.status === 'signedIn' ? (base.user?.uid ?? null) : null;
  useEffect(() => {
    if (!uid) {
      setStaff(null);
      return undefined;
    }
    return onSnapshot(
      doc(db, COLLECTIONS.midwives, uid),
      (snap) => {
        // Deactivation is handled by SessionGuard: it logs out only when nothing unsynced would be wiped.
        setStaff(snap.exists() ? (snap.data() as StaffDoc) : null);
      },
      () => setStaff(null),
    );
  }, [uid]);

  const value = useMemo<AuthValue>(() => {
    const { user, claims } = base;
    const ctx: WriteCtx | null =
      user && claims?.clinicId
        ? { uid: user.uid, role: claims.role, clinicId: claims.clinicId, staffName: staff?.name || user.email || 'Staff' }
        : null;
    return { ...base, staff, ctx, deactivated: staff?.active === false };
  }, [base, staff]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

/** Forces an ID-token refresh so claims granted server-side (registerClinic / joinClinic) take effect now. */
export async function refreshClaims(): Promise<void> {
  await auth.currentUser?.getIdToken(true);
}

/** Where a signed-in user without a clinic should go: mobile accounts enter a server code, email accounts register a clinic. */
export function onboardingPath(user: User | null): string {
  return user?.phoneNumber ? '/join' : '/signup';
}

/** Use inside clinic-only screens (guarded by RequireClinic), where ctx is guaranteed. */
export function useCtx(): WriteCtx {
  const { ctx } = useAuth();
  if (!ctx) throw new Error('Clinic context required');
  return ctx;
}
