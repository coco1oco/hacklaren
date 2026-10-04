import { useMemo } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router-dom';
import { visitClinicalSchema, type VisitClinicalInput } from '@shared/schemas';
import { DANGER_SIGN_LABELS, URINE_RESULTS, type DangerSigns } from '@shared/types';
import { RANGE_WARNING, outsideExpectedRange, sortVisitsAsc, type RangedField } from '@shared/riskFlags';
import { todayIso } from '@shared/pregnancy';
import { useCtx } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { createVisit } from '@/lib/writes';
import { logAudit } from '@/lib/audit';
import { URINE_LABELS } from '@/lib/format';
import { optionalNumber, pregnancyStatus, requiredNumber } from '@/lib/pregnancyView';
import { ChipsInput } from '@/components/ChipsInput';
import { Alert, Button, Card, CheckboxField, Loading, PageHeader, SelectField, TextAreaField, TextField } from '@/components/ui';

const MED_SUGGESTIONS = ['Ferrous sulfate + folic acid', 'Calcium carbonate', 'Multivitamins', 'Tetanus toxoid'];

export default function NewVisitPage() {
  const { patientId = '' } = useParams();
  const ctx = useCtx();
  const navigate = useNavigate();
  const { patients, patientsLoading, visits } = useClinicData();
  const patient = patients.find((p) => p.patientId === patientId) ?? null;
  const lastVisit = useMemo(() => {
    const asc = sortVisitsAsc(visits.filter((v) => v.patientId === patientId));
    return asc.length ? asc[asc.length - 1] : null;
  }, [visits, patientId]);

  if (patientsLoading) return <Loading />;
  if (!patient) return <Alert tone="error">Patient not found.</Alert>;

  const defaults: VisitClinicalInput = {
    visitDate: todayIso(),
    bpSystolic: Number.NaN,
    bpDiastolic: Number.NaN,
    weightKg: Number.NaN,
    fhr: null,
    glucoseMgDl: null,
    fundalHeightCm: null,
    urineProtein: 'not_done',
    urineGlucose: 'not_done',
    medications: lastVisit ? [...lastVisit.medications] : [],
    notes: '',
    dangerSigns: { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false },
  };

  function save(input: VisitClinicalInput) {
    // Not awaited: saved to the local cache immediately and synced when online.
    createVisit(ctx, patientId, input);
    logAudit(ctx, 'visit_created', patientId);
    navigate(`/patients/${patientId}`, { replace: true, state: { flash: 'Visit saved on this device. Pending sync until the server confirms it.' } });
  }

  return (
    <div>
      <PageHeader title="New visit" subtitle={`${patient.name} · ${pregnancyStatus(patient.pregnancy?.lmp).gaLabel}`} />
      <VisitForm defaults={defaults} onSave={save} hasLastVisit={!!lastVisit} />
    </div>
  );
}

function VisitForm({ defaults, onSave, hasLastVisit }: { defaults: VisitClinicalInput; onSave: (v: VisitClinicalInput) => void; hasLastVisit: boolean }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(visitClinicalSchema), defaultValues: defaults });
  const values = useWatch({ control });

  function warn(field: RangedField): string | undefined {
    const v = values[field];
    return typeof v === 'number' && outsideExpectedRange(field, v) ? RANGE_WARNING : undefined;
  }

  const num = (field: 'bpSystolic' | 'bpDiastolic' | 'weightKg') => register(field, { setValueAs: requiredNumber });
  const optNum = (field: 'fhr' | 'glucoseMgDl' | 'fundalHeightCm') => register(field, { setValueAs: optionalNumber });

  return (
    <form onSubmit={handleSubmit(onSave)} noValidate className="space-y-4">
      {Object.keys(errors).length > 0 && <Alert tone="error">Some information is missing or invalid. Please check the highlighted fields.</Alert>}
      <Card title="Measurements">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Visit date" type="date" max={todayIso()} {...register('visitDate')} error={errors.visitDate?.message} />
          <div />
          <TextField label="BP systolic (mmHg)" type="number" inputMode="numeric" placeholder="e.g. 120" {...num('bpSystolic')} error={errors.bpSystolic?.message} warning={warn('bpSystolic')} />
          <TextField label="BP diastolic (mmHg)" type="number" inputMode="numeric" placeholder="e.g. 80" {...num('bpDiastolic')} error={errors.bpDiastolic?.message} warning={warn('bpDiastolic')} />
          <TextField label="Weight (kg)" type="number" inputMode="decimal" step="0.1" placeholder="e.g. 58.5" {...num('weightKg')} error={errors.weightKg?.message} warning={warn('weightKg')} />
          <TextField label="Fetal heart rate (bpm)" hint="Optional" type="number" inputMode="numeric" placeholder="e.g. 140" {...optNum('fhr')} error={errors.fhr?.message} warning={warn('fhr')} />
          <TextField label="Glucose (mg/dL)" hint="Optional" type="number" inputMode="numeric" placeholder="e.g. 95" {...optNum('glucoseMgDl')} error={errors.glucoseMgDl?.message} warning={warn('glucoseMgDl')} />
          <TextField
            label="Fundal height (cm)"
            hint="Optional"
            type="number"
            inputMode="decimal"
            step="0.5"
            placeholder="e.g. 28"
            {...optNum('fundalHeightCm')}
            error={errors.fundalHeightCm?.message}
            warning={warn('fundalHeightCm')}
          />
          <SelectField label="Urine protein" {...register('urineProtein')} error={errors.urineProtein?.message}>
            {URINE_RESULTS.map((u) => (
              <option key={u} value={u}>
                {URINE_LABELS[u]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Urine glucose" {...register('urineGlucose')} error={errors.urineGlucose?.message}>
            {URINE_RESULTS.map((u) => (
              <option key={u} value={u}>
                {URINE_LABELS[u]}
              </option>
            ))}
          </SelectField>
        </div>
      </Card>

      <Card title="Danger signs">
        <fieldset>
          <legend className="mb-1 text-slate-700">Check any danger sign the patient reports today.</legend>
          {(Object.keys(DANGER_SIGN_LABELS) as (keyof DangerSigns)[]).map((k) => (
            <CheckboxField key={k} label={DANGER_SIGN_LABELS[k]} {...register(`dangerSigns.${k}`)} />
          ))}
        </fieldset>
      </Card>

      <Card title="Medications and notes">
        <div className="space-y-4">
          <Controller
            control={control}
            name="medications"
            render={({ field, fieldState }) => (
              <ChipsInput
                label="Medications"
                value={field.value}
                onChange={field.onChange}
                suggestions={MED_SUGGESTIONS}
                hint={hasLastVisit ? 'Prefilled from the last visit. Remove any the patient no longer takes.' : undefined}
                error={fieldState.error?.message}
              />
            )}
          />
          <TextAreaField label="Notes" rows={4} placeholder="e.g. Patient reports mild swelling of feet. Advised rest and follow-up in 1 week." {...register('notes')} error={errors.notes?.message} />
        </div>
      </Card>

      <p className="text-sm text-slate-700">The visit is saved on this device first and syncs automatically when online.</p>
      <Button type="submit" className="w-full md:w-auto" disabled={isSubmitting}>
        Save visit
      </Button>
    </form>
  );
}
