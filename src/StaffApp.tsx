import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { RequireAuth, RequireClinic, RequireRole } from '@/auth/guards';
import { SessionGuard } from '@/auth/SessionGuard';
import { ClinicDataProvider } from '@/data/ClinicDataProvider';
import { Layout } from '@/components/Layout';
import { Loading } from '@/components/ui';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const SignupClinicPage = lazy(() => import('@/pages/auth/SignupClinicPage'));
const JoinClinicPage = lazy(() => import('@/pages/auth/JoinClinicPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const PatientsPage = lazy(() => import('@/pages/patients/PatientsPage'));
const NewPatientPage = lazy(() => import('@/pages/patients/NewPatientPage'));
const EditPatientPage = lazy(() => import('@/pages/patients/EditPatientPage'));
const PatientProfilePage = lazy(() => import('@/pages/patients/PatientProfilePage'));
const NewVisitPage = lazy(() => import('@/pages/patients/NewVisitPage'));
const HospitalsPage = lazy(() => import('@/pages/HospitalsPage'));
const HelpPage = lazy(() => import('@/pages/HelpPage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));
const AdminHubPage = lazy(() => import('@/pages/admin/AdminHubPage'));
const AdminStaffPage = lazy(() => import('@/pages/admin/AdminStaffPage'));
const AdminHospitalsPage = lazy(() => import('@/pages/admin/AdminHospitalsPage'));
const AdminClinicsPage = lazy(() => import('@/pages/admin/AdminClinicsPage'));
const AdminReportsPage = lazy(() => import('@/pages/admin/AdminReportsPage'));

// Owned by the referral workstream (part B).
const EmergencyReferralPage = lazy(() => import('@/pages/referrals/EmergencyReferralPage'));
const CheckupReferralPage = lazy(() => import('@/pages/referrals/CheckupReferralPage'));
const ReferralsListPage = lazy(() => import('@/pages/referrals/ReferralsListPage'));
const ReferralDetailPage = lazy(() => import('@/pages/referrals/ReferralDetailPage'));
const ReferralSlipPage = lazy(() => import('@/pages/referrals/ReferralSlipPage'));

const ADMINS = ['clinic_admin', 'super_admin'] as const;

function Clinic({ children }: { children: ReactNode }) {
  return <RequireClinic>{children}</RequireClinic>;
}

function Admin({ children, superOnly = false }: { children: ReactNode; superOnly?: boolean }) {
  return <RequireRole roles={superOnly ? ['super_admin'] : [...ADMINS]}>{children}</RequireRole>;
}

/** super_admin has no clinic and no clinical dashboard; send them to the admin hub. */
function HomeRoute() {
  const { claims } = useAuth();
  if (claims?.role === 'super_admin') return <Navigate to="/admin" replace />;
  return (
    <Clinic>
      <DashboardPage />
    </Clinic>
  );
}

function ProtectedShell() {
  return (
    <RequireAuth>
      <SessionGuard>
        <Layout />
      </SessionGuard>
    </RequireAuth>
  );
}

export default function StaffApp() {
  return (
    <AuthProvider>
      <ClinicDataProvider>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/signup" element={<SignupClinicPage />} />
            <Route path="/join" element={<JoinClinicPage />} />
            <Route element={<ProtectedShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<HomeRoute />} />
              <Route path="patients" element={<Clinic><PatientsPage /></Clinic>} />
              <Route path="patients/new" element={<Clinic><NewPatientPage /></Clinic>} />
              <Route path="patients/:patientId" element={<Clinic><PatientProfilePage /></Clinic>} />
              <Route path="patients/:patientId/edit" element={<Clinic><EditPatientPage /></Clinic>} />
              <Route path="patients/:patientId/visit/new" element={<Clinic><NewVisitPage /></Clinic>} />
              <Route path="patients/:patientId/referral/emergency" element={<Clinic><EmergencyReferralPage /></Clinic>} />
              <Route path="patients/:patientId/referral/checkup" element={<Clinic><CheckupReferralPage /></Clinic>} />
              <Route path="referrals" element={<Clinic><ReferralsListPage /></Clinic>} />
              <Route path="referrals/:referralId" element={<Clinic><ReferralDetailPage /></Clinic>} />
              <Route path="referrals/:referralId/slip" element={<Clinic><ReferralSlipPage /></Clinic>} />
              <Route path="hospitals" element={<HospitalsPage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="admin" element={<Admin><AdminHubPage /></Admin>} />
              <Route path="admin/midwives" element={<Admin><AdminStaffPage /></Admin>} />
              <Route path="admin/hospitals" element={<Admin superOnly><AdminHospitalsPage /></Admin>} />
              <Route path="admin/clinics" element={<Admin><AdminClinicsPage /></Admin>} />
              <Route path="admin/reports" element={<Admin><AdminReportsPage /></Admin>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </ClinicDataProvider>
    </AuthProvider>
  );
}
