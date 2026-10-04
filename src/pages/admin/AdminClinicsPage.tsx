import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, type ClinicDoc } from '@shared/contracts';
import { phMobile, phoneNumber } from '@shared/schemas';
import { useAuth } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { useAllClinics } from '@/data/hospitals';
import { db } from '@/lib/firebase';
import type { WithMeta } from '@/lib/firestore';
import { userMessage } from '@/lib/errors';
import { optionalNumber } from '@/lib/pregnancyView';
import { useOnline } from '@/lib/useOnline';
import { Alert, Badge, Button, Card, CheckboxField, Loading, PageHeader, TextField } from '@/components/ui';

const optionalPhone = (schema: z.ZodType<string>, msg: string) =>
  z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === '' || schema.safeParse(v).success, { message: msg });

const clinicSchema = z.object({
  name: z.string().trim().min(1, { message: 'Clinic name is required.' }).max(160),
  address: z.string().trim().max(300),
  barangay: z.string().trim().max(120),
  city: z.string().trim().max(120),
  province: z.string().trim().max(120),
  contactNumber: optionalPhone(phoneNumber, 'Enter a valid phone number.'),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  bhwContactNumber: optionalPhone(phMobile, 'Enter a valid PH mobile number (09XXXXXXXXX).'),
  mhoContactNumber: optionalPhone(phMobile, 'Enter a valid PH mobile number (09XXXXXXXXX).'),
  active: z.boolean(),
});
type ClinicForm = z.infer<typeof clinicSchema>;

const EMPTY: ClinicForm = {
  name: '',
  address: '',
  barangay: '',
  city: '',
  province: '',
  contactNumber: '',
  latitude: null,
  longitude: null,
  bhwContactNumber: '',
  mhoContactNumber: '',
  active: true,
};

function toForm(c: ClinicDoc): ClinicForm {
  return {
    name: c.name,
    address: c.address,
    barangay: c.barangay,
    city: c.city,
    province: c.province,
    contactNumber: c.contactNumber,
    latitude: c.latitude,
    longitude: c.longitude,
    bhwContactNumber: c.bhwContactNumber ?? '',
    mhoContactNumber: c.mhoContactNumber ?? '',
    active: c.active,
  };
}

/** Fields a clinic_admin may change on their own clinic (must match clinicAdminEditableKeys in firestore.rules). */
function editableFields(v: ClinicForm) {
  return {
    name: v.name,
    address: v.address,
    barangay: v.barangay,
    city: v.city,
    province: v.province,
    contactNumber: v.contactNumber,
    latitude: v.latitude,
    longitude: v.longitude,
    bhwContactNumber: v.bhwContactNumber || null,
    mhoContactNumber: v.mhoContactNumber || null,
  };
}

function ClinicFormView({ editing, isSuper, onDone }: { editing: WithMeta<ClinicDoc> | null; isSuper: boolean; onDone: (msg: string) => void }) {
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(clinicSchema), defaultValues: editing ? toForm(editing) : EMPTY });

  async function save(v: ClinicForm) {
    setError(null);
    try {
      if (editing) {
        const data: Record<string, unknown> = { ...editableFields(v), updatedAt: serverTimestamp() };
        if (isSuper) data.active = v.active;
        await updateDoc(doc(db, COLLECTIONS.clinics, editing.id), data);
      } else {
        await addDoc(collection(db, COLLECTIONS.clinics), { ...editableFields(v), active: v.active, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      onDone(editing ? `Saved changes to ${v.name}.` : `Added ${v.name}.`);
    } catch (err) {
      setError(userMessage(err, 'Could not save the clinic. Please try again.'));
    }
  }

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="grid gap-4 md:grid-cols-2">
      <TextField label="Clinic name" {...register('name')} error={errors.name?.message} />
      <TextField label="Clinic phone" type="tel" inputMode="tel" {...register('contactNumber')} error={errors.contactNumber?.message} />
      <TextField label="Address" className="md:col-span-2" {...register('address')} error={errors.address?.message} />
      <TextField label="Barangay" {...register('barangay')} error={errors.barangay?.message} />
      <TextField label="City / Municipality" {...register('city')} error={errors.city?.message} />
      <TextField label="Province" {...register('province')} error={errors.province?.message} />
      <div />
      <TextField
        label="BHW mobile number"
        hint="Barangay Health Worker. Receives emergency alerts (no clinical details)."
        type="tel"
        inputMode="tel"
        placeholder="09XXXXXXXXX"
        {...register('bhwContactNumber')}
        error={errors.bhwContactNumber?.message}
      />
      <TextField
        label="MHO mobile number"
        hint="Municipal Health Office. Receives emergency alerts (no clinical details)."
        type="tel"
        inputMode="tel"
        placeholder="09XXXXXXXXX"
        {...register('mhoContactNumber')}
        error={errors.mhoContactNumber?.message}
      />
      <TextField label="Latitude" hint="Optional" type="number" step="any" inputMode="decimal" {...register('latitude', { setValueAs: optionalNumber })} error={errors.latitude?.message} />
      <TextField label="Longitude" hint="Optional" type="number" step="any" inputMode="decimal" {...register('longitude', { setValueAs: optionalNumber })} error={errors.longitude?.message} />
      {isSuper && <CheckboxField label="Active" hint="Clinics are never deleted. Untick to deactivate." {...register('active')} />}
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="submit" disabled={isSubmitting || !online}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add clinic'}
        </Button>
        {editing && isSuper && (
          <Button variant="secondary" onClick={() => onDone('')}>
            Cancel
          </Button>
        )}
      </div>
      {!online && <p className="text-sm text-slate-700 md:col-span-2">Saving needs an internet connection.</p>}
      {error && (
        <Alert tone="error" className="md:col-span-2">
          {error}
        </Alert>
      )}
    </form>
  );
}

function OwnClinic() {
  const { clinic } = useClinicData();
  const [message, setMessage] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  if (!clinic) return <Loading label="Loading clinic…" />;
  return (
    <div className="space-y-4">
      <PageHeader title="Clinic details" subtitle={clinic.name} />
      {message && <Alert tone="success">{message}</Alert>}
      <Card title="Contact details">
        <ClinicFormView
          key={formKey}
          editing={clinic}
          isSuper={false}
          onDone={(m) => {
            setMessage(m || null);
            setFormKey((k) => k + 1);
          }}
        />
      </Card>
    </div>
  );
}

function AllClinics() {
  const { data, loading, error } = useAllClinics(true);
  const [editing, setEditing] = useState<WithMeta<ClinicDoc> | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  function done(msg: string) {
    setEditing(null);
    setFormKey((k) => k + 1);
    setMessage(msg || null);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Clinics" subtitle="Super admin" />
      {message && <Alert tone="success">{message}</Alert>}
      <Card title={editing ? `Edit ${editing.name}` : 'Add clinic'} id="clinic-form">
        <ClinicFormView key={editing ? `e-${editing.id}-${formKey}` : `n-${formKey}`} editing={editing} isSuper onDone={done} />
      </Card>
      <Card title="All clinics">
        {error && <Alert tone="error">Could not load clinics.</Alert>}
        {loading ? (
          <Loading />
        ) : data.length === 0 ? (
          <p className="text-slate-700">No clinics yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-bold">
                    {c.name} {!c.active && <Badge>Inactive</Badge>}
                  </p>
                  <p className="text-sm text-slate-700">{[c.barangay, c.city, c.province].filter(Boolean).join(', ') || '—'}</p>
                </div>
                <Button
                  variant="secondary"
                  aria-label={`Edit ${c.name}`}
                  onClick={() => {
                    setMessage(null);
                    setEditing(c);
                    document.getElementById('clinic-form')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function AdminClinicsPage() {
  const { claims } = useAuth();
  return claims?.role === 'super_admin' ? <AllClinics /> : <OwnClinic />;
}
