import { useMemo } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { useHospitals, usePatientVisits } from '@/components/referral/hooks';

/** Patient + clinic + hospitals + visits needed by the referral creation pages. */
export function usePatientReferralContext(patientId: string | undefined) {
  const { ctx, staff } = useAuth();
  const data = useClinicData();
  const patient = useMemo(() => data.patients.find((p) => p.patientId === patientId || p.id === patientId) ?? null, [data.patients, patientId]);
  const hospitals = useHospitals();
  const visits = usePatientVisits(patientId, data.clinicId);
  return { ctx, staff, data, patient, hospitals, visits };
}
