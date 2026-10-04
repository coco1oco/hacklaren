import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { PatientInput } from '@shared/schemas';
import type { PatientDoc } from '@shared/contracts';
import { useCtx } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { updatePatient } from '@/lib/writes';
import { logAudit } from '@/lib/audit';
import { Alert, Loading, PageHeader } from '@/components/ui';
import { PatientForm } from './PatientForm';

function toInput(p: PatientDoc): PatientInput {
  return {
    name: p.name,
    birthdate: p.birthdate,
    address: p.address,
    barangay: p.barangay,
    contactNumber: p.contactNumber,
    emergencyContact: { ...p.emergencyContact },
    pregnancy: { ...p.pregnancy },
    allergies: [...(p.allergies ?? [])],
    bloodType: p.bloodType,
    medicalHistory: [...(p.medicalHistory ?? [])],
    obstetricHistory: [...(p.obstetricHistory ?? [])],
    consentGiven: p.consent?.dataSharingForReferral ?? false,
  };
}

export default function EditPatientPage() {
  const { patientId = '' } = useParams();
  const ctx = useCtx();
  const navigate = useNavigate();
  const { patients, patientsLoading } = useClinicData();
  const patient = useMemo(() => patients.find((p) => p.patientId === patientId) ?? null, [patients, patientId]);
  // Snapshot the initial values once so realtime updates do not reset the form while editing.
  // The base record is snapshotted too: the diff (changed fields) and version are computed against what the form showed.
  const base = useMemo(() => patient, [patient?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => (base ? toInput(base) : null), [base]);

  if (patientsLoading) return <Loading />;
  if (!patient || !base || !initial) return <Alert tone="error">Patient not found.</Alert>;

  function save(input: PatientInput) {
    if (!base) return;
    // Writes only the changed fields with version = base + 1. A stale edit is rejected by the server and kept for review.
    const changed = updatePatient(ctx, base, input);
    if (changed) logAudit(ctx, 'patient_edited', base.patientId);
    const flash = changed ? 'Changes saved on this device. They will sync with the server automatically.' : 'No changes to save.';
    navigate(`/patients/${base.patientId}`, { replace: true, state: { flash } });
  }

  return (
    <div>
      <PageHeader title={`Edit ${patient.name}`} subtitle={patient.patientId} />
      <PatientForm initial={initial} checkDuplicates={false} excludeId={patient.patientId} submitLabel="Save changes" isEdit onSave={save} />
    </div>
  );
}
