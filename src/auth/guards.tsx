import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@shared/types';
import { Loading } from '@/components/ui';
import { onboardingPath, useAuth } from './AuthProvider';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (status === 'unassigned') return <Navigate to={onboardingPath(user)} replace />;
  return <>{children}</>;
}

/** UI-level role gate. Real enforcement is server-side (rules + functions verify custom claims). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { claims } = useAuth();
  if (!claims || !roles.includes(claims.role)) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold">Not available</h1>
        <p>Your role does not have access to this page.</p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Clinical screens require a clinic (super_admin has none). */
export function RequireClinic({ children }: { children: ReactNode }) {
  const { ctx } = useAuth();
  if (!ctx) {
    return (
      <div className="p-4">
        <h1 className="text-xl font-bold">Clinic staff only</h1>
        <p>Patient records belong to a clinic. Your account is not assigned to a clinic. Use the Admin section instead.</p>
      </div>
    );
  }
  return <>{children}</>;
}
