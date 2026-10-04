import { useNavigate } from 'react-router-dom';
import { newPatientId } from '@shared/ids';
import type { PatientInput } from '@shared/schemas';
import { useCtx } from '@/auth/AuthProvider';
import { createPatient } from '@/lib/writes';
import { logAudit } from '@/lib/audit';
import { PageHeader } from '@/components/ui';
import { PatientForm } from './PatientForm';
import { EMPTY_PATIENT } from './patientDefaults';

export default function NewPatientPage() {
  const ctx = useCtx();
  const navigate = useNavigate();

  function save(input: PatientInput) {
    const patientId = newPatientId();
    // Not awaited: works offline; rejections are kept as sync conflicts.
    createPatient(ctx, patientId, input);
    logAudit(ctx, 'patient_created', patientId);
    navigate(`/patients/${patientId}`, { replace: true, state: { flash: 'Patient registered on this device. It will show "Pending sync" until the server confirms it.' } });
  }

  return (
    <div>
      <PageHeader title="Register patient" subtitle="Bagong pasyente" />
      <PatientForm initial={EMPTY_PATIENT} checkDuplicates submitLabel="Register patient" onSave={save} />
    </div>
  );
}
