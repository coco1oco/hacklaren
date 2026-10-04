import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { patientInputSchema, type PatientInput } from '@shared/schemas';
import { BLOOD_TYPES } from '@shared/types';
import { checkPregnancyDates, eddFromLmp, todayIso } from '@shared/pregnancy';
import { useClinicData } from '@/data/ClinicDataProvider';
import { findPossibleDuplicates } from '@/lib/duplicates';
import { formatDate } from '@/lib/format';
import { pregnancyStatus } from '@/lib/pregnancyView';
import { ChipsInput } from '@/components/ChipsInput';
import { Alert, Button, Card, CheckboxField, SelectField, TextField } from '@/components/ui';

const ALLERGY_SUGGESTIONS = ['Penicillin', 'Sulfa drugs', 'Iodine', 'Latex', 'Seafood'];
const MEDICAL_SUGGESTIONS = ['Hypertension', 'Diabetes', 'Asthma', 'Heart disease', 'Anemia', 'Thyroid disease'];
const OB_SUGGESTIONS = ['Previous cesarean section', 'Previous miscarriage', 'Previous preterm birth', 'Previous postpartum hemorrhage', 'Previous pre-eclampsia'];

interface Props {
  initial: PatientInput;
  /** Registration only: warn about possible existing patients before saving. */
  checkDuplicates: boolean;
  excludeId?: string;
  submitLabel: string;
  isEdit?: boolean;
  onSave: (input: PatientInput) => void;
}

export function PatientForm({ initial, checkDuplicates, excludeId, submitLabel, isEdit = false, onSave }: Props) {
  const { patients } = useClinicData();
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(patientInputSchema), defaultValues: initial });

  const lmp = useWatch({ control, name: 'pregnancy.lmp' });
  const edd = useWatch({ control, name: 'pregnancy.edd' });
  const [eddManual, setEddManual] = useState(isEdit);
  const [datesConfirmed, setDatesConfirmed] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<typeof patients>([]);
  const [pending, setPending] = useState<PatientInput | null>(null);

  const suggestedEdd = lmp ? eddFromLmp(lmp) : null;
  useEffect(() => {
    if (!eddManual && suggestedEdd) setValue('pregnancy.edd', suggestedEdd);
  }, [eddManual, suggestedEdd, setValue]);

  const status = pregnancyStatus(lmp);
  const dateWarnings = useMemo(() => (lmp && edd ? checkPregnancyDates(lmp, edd).warnings : []), [lmp, edd]);

  function onValid(data: PatientInput) {
    if (dateWarnings.length && !datesConfirmed) {
      setDatesError('Please confirm that the pregnancy dates are correct.');
      return;
    }
    setDatesError(null);
    if (checkDuplicates) {
      const found = findPossibleDuplicates(
        { name: data.name, birthdate: data.birthdate, contactNumber: data.contactNumber, lmp: data.pregnancy.lmp },
        patients,
        excludeId,
      );
      if (found.length) {
        setDupes(found);
        setPending(data);
        return;
      }
    }
    onSave(data);
  }

  const today = todayIso();

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate className="space-y-4">
      {Object.keys(errors).length > 0 && <Alert tone="error">Some information is missing or invalid. Please check the highlighted fields.</Alert>}

      <Card title="Patient details">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Full name" autoComplete="off" placeholder="e.g. Maria Santos" {...register('name')} error={errors.name?.message} />
          <TextField label="Birthdate" type="date" max={today} {...register('birthdate')} error={errors.birthdate?.message} />
          <TextField label="Address" className="md:col-span-2" placeholder="e.g. 123 Sampaguita St., Purok 2" {...register('address')} error={errors.address?.message} />
          <TextField label="Barangay" placeholder="e.g. San Isidro" {...register('barangay')} error={errors.barangay?.message} />
          <TextField label="Mobile number" type="tel" inputMode="tel" placeholder="09XXXXXXXXX" {...register('contactNumber')} error={errors.contactNumber?.message} />
        </div>
      </Card>

      <Card title="Emergency contact">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="Emergency contact name" placeholder="e.g. Jose Santos" {...register('emergencyContact.name')} error={errors.emergencyContact?.name?.message} />
          <TextField label="Relationship" placeholder="e.g. Husband, Mother" {...register('emergencyContact.relationship')} error={errors.emergencyContact?.relationship?.message} />
          <TextField
            label="Emergency contact mobile number"
            type="tel"
            inputMode="tel"
            placeholder="09XXXXXXXXX"
            {...register('emergencyContact.contactNumber')}
            error={errors.emergencyContact?.contactNumber?.message}
          />
        </div>
      </Card>

      <Card title="Pregnancy">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="LMP (last menstrual period)" type="date" max={today} {...register('pregnancy.lmp')} error={errors.pregnancy?.lmp?.message} />
          <div>
            <TextField
              label="EDD (expected delivery date)"
              type="date"
              {...register('pregnancy.edd', { onChange: () => setEddManual(true) })}
              error={errors.pregnancy?.edd?.message}
              hint={suggestedEdd ? `Suggested from LMP: ${formatDate(suggestedEdd)}` : 'Enter LMP to get a suggested EDD.'}
            />
            {suggestedEdd && edd !== suggestedEdd && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEddManual(false);
                  setValue('pregnancy.edd', suggestedEdd, { shouldValidate: true });
                }}
              >
                Use suggested EDD
              </Button>
            )}
          </div>
          <TextField
            label="Gravida (G): total pregnancies"
            hint="Every pregnancy, however it ended: this one, miscarriages, ectopic pregnancies and births. Twins or triplets count as 1."
            type="number"
            inputMode="numeric"
            min={1}
            max={20}
            placeholder="e.g. 3"
            {...register('pregnancy.gravida', { valueAsNumber: true })}
            error={errors.pregnancy?.gravida?.message}
          />
          <TextField
            label="Para (P): births at 20+ weeks"
            hint="Past pregnancies that reached 20 weeks or more (live birth or stillbirth). Losses before 20 weeks are not counted. Twins or triplets count as 1."
            type="number"
            inputMode="numeric"
            min={0}
            max={20}
            placeholder="e.g. 2"
            {...register('pregnancy.para', { valueAsNumber: true })}
            error={errors.pregnancy?.para?.message}
          />
        </div>
        <p aria-live="polite" className="mt-3 rounded-lg bg-slate-100 p-3 font-semibold">
          Gestational age today: {status.gaLabel} · {status.trimesterLabel}
        </p>
        {dateWarnings.length > 0 && (
          <div className="mt-3">
            <Alert tone="warning" title="Please check the pregnancy dates">
              <ul className="ml-5 list-disc">
                {dateWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
            <CheckboxField
              className="mt-2"
              label="I have verified these dates and they are correct"
              checked={datesConfirmed}
              onChange={(e) => {
                setDatesConfirmed(e.target.checked);
                if (e.target.checked) setDatesError(null);
              }}
              error={datesError ?? undefined}
            />
          </div>
        )}
      </Card>

      <Card title="Medical information">
        <div className="space-y-4">
          <SelectField label="Blood type" {...register('bloodType')} error={errors.bloodType?.message}>
            {BLOOD_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </SelectField>
          <Controller
            control={control}
            name="allergies"
            render={({ field, fieldState }) => (
              <ChipsInput label="Allergies" value={field.value} onChange={field.onChange} suggestions={ALLERGY_SUGGESTIONS} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="medicalHistory"
            render={({ field, fieldState }) => (
              <ChipsInput label="Medical history" value={field.value} onChange={field.onChange} suggestions={MEDICAL_SUGGESTIONS} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="obstetricHistory"
            render={({ field, fieldState }) => (
              <ChipsInput label="Obstetric history" value={field.value} onChange={field.onChange} suggestions={OB_SUGGESTIONS} error={fieldState.error?.message} />
            )}
          />
        </div>
      </Card>

      <Card title="Consent">
        <CheckboxField
          label="Patient consents to sharing her record for referral purposes"
          hint={
            isEdit
              ? 'Changing this records a new consent capture under your name and the current time.'
              : 'Explain to the patient how her record is shared with the receiving hospital. Emergency referrals can still be sent without consent.'
          }
          {...register('consentGiven')}
        />
      </Card>

      {dupes.length > 0 && pending && (
        <div role="alert" className="rounded-lg border-l-4 border-amber-600 bg-amber-50 p-3 text-amber-950">
          {dupes.map((d) => (
            <div key={d.patientId} className="mb-3">
              <p className="font-bold">
                Possible existing patient — {d.name}, Patient ID {d.patientId}
              </p>
              <p className="text-sm">
                Born {formatDate(d.birthdate)} · {d.contactNumber} · {d.barangay}
              </p>
              <Link to={`/patients/${d.patientId}`} className="mt-1 inline-flex min-h-12 items-center rounded-lg border-2 border-slate-400 bg-white px-4 font-semibold">
                View Existing
              </Link>
            </div>
          ))}
          <Button
            onClick={() => {
              const data = pending;
              setDupes([]);
              setPending(null);
              onSave(data);
            }}
          >
            Continue Anyway
          </Button>
        </div>
      )}

      <Button type="submit" className="w-full md:w-auto" disabled={isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
