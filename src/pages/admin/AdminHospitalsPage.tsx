import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, type HospitalDoc } from '@shared/contracts';
import { hospitalInputSchema, type HospitalInput } from '@shared/schemas';
import { HOSPITAL_SERVICES } from '@shared/types';
import { useHospitals } from '@/data/hospitals';
import { db } from '@/lib/firebase';
import type { WithMeta } from '@/lib/firestore';
import { userMessage } from '@/lib/errors';
import { useOnline } from '@/lib/useOnline';
import { Alert, Badge, Button, Card, CheckboxField, Loading, PageHeader, SelectField, TextField } from '@/components/ui';

const EMPTY: HospitalInput = {
  name: '',
  address: '',
  phone: '',
  referralLevel: 2,
  services: [],
  latitude: Number.NaN,
  longitude: Number.NaN,
  dohNetworked: false,
  active: true,
};

function toInput(h: HospitalDoc): HospitalInput {
  return {
    name: h.name,
    address: h.address,
    phone: h.phone,
    referralLevel: h.referralLevel,
    services: [...h.services],
    latitude: h.latitude,
    longitude: h.longitude,
    dohNetworked: h.dohNetworked,
    active: h.active,
  };
}

function HospitalForm({ editing, onDone }: { editing: WithMeta<HospitalDoc> | null; onDone: (msg: string) => void }) {
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(hospitalInputSchema), defaultValues: editing ? toInput(editing) : EMPTY });

  async function save(v: HospitalInput) {
    setError(null);
    // Exact key set required by firestore.rules (validHospital).
    const data = {
      name: v.name,
      address: v.address,
      phone: v.phone,
      referralLevel: v.referralLevel,
      services: v.services,
      latitude: v.latitude,
      longitude: v.longitude,
      dohNetworked: v.dohNetworked,
      active: v.active,
    };
    try {
      if (editing) await updateDoc(doc(db, COLLECTIONS.hospitals, editing.id), { ...data, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, COLLECTIONS.hospitals), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      onDone(editing ? `Saved changes to ${v.name}.` : `Added ${v.name}.`);
    } catch (err) {
      setError(userMessage(err, 'Could not save the hospital. Please try again.'));
    }
  }

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="grid gap-4 md:grid-cols-2">
      <TextField label="Hospital name" {...register('name')} error={errors.name?.message} />
      <TextField label="Phone" type="tel" inputMode="tel" {...register('phone')} error={errors.phone?.message} />
      <TextField label="Address" className="md:col-span-2" {...register('address')} error={errors.address?.message} />
      <SelectField label="Referral level" {...register('referralLevel', { setValueAs: (v) => Number(v) })} error={errors.referralLevel?.message}>
        <option value={1}>Level 1</option>
        <option value={2}>Level 2</option>
        <option value={3}>Level 3</option>
      </SelectField>
      <fieldset>
        <legend className="mb-1 font-semibold">Services</legend>
        <div className="flex flex-wrap gap-x-4">
          {HOSPITAL_SERVICES.map((s) => (
            <CheckboxField key={s} label={s} value={s} {...register('services')} />
          ))}
        </div>
        {errors.services && <p className="text-sm font-semibold text-red-800">{errors.services.message}</p>}
      </fieldset>
      <TextField label="Latitude" type="number" step="any" inputMode="decimal" {...register('latitude', { valueAsNumber: true })} error={errors.latitude?.message} />
      <TextField label="Longitude" type="number" step="any" inputMode="decimal" {...register('longitude', { valueAsNumber: true })} error={errors.longitude?.message} />
      <CheckboxField label="DOH-networked facility" {...register('dohNetworked')} />
      <CheckboxField label="Active (shown to midwives)" hint="Hospitals are never deleted. Untick to deactivate." {...register('active')} />
      <div className="flex flex-wrap gap-2 md:col-span-2">
        <Button type="submit" disabled={isSubmitting || !online}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add hospital'}
        </Button>
        {editing && (
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

export default function AdminHospitalsPage() {
  const { data, loading, error } = useHospitals();
  const [editing, setEditing] = useState<WithMeta<HospitalDoc> | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  function done(msg: string) {
    setEditing(null);
    setFormKey((k) => k + 1);
    setMessage(msg || null);
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Hospitals" subtitle="Super admin" />
      {message && <Alert tone="success">{message}</Alert>}
      <Card title={editing ? `Edit ${editing.name}` : 'Add hospital'} id="hospital-form">
        <HospitalForm key={editing ? `e-${editing.id}-${formKey}` : `n-${formKey}`} editing={editing} onDone={done} />
      </Card>
      <Card title="All hospitals">
        {error && <Alert tone="error">Could not load hospitals.</Alert>}
        {loading ? (
          <Loading />
        ) : data.length === 0 ? (
          <p className="text-slate-700">No hospitals yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-bold">
                    {h.name} {!h.active && <Badge>Inactive</Badge>}
                  </p>
                  <p className="text-sm text-slate-700">
                    Level {h.referralLevel} · {h.services.join(', ') || 'No services listed'} · {h.phone}
                    {h.dohNetworked && ' · DOH-networked'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  aria-label={`Edit ${h.name}`}
                  onClick={() => {
                    setMessage(null);
                    setEditing(h);
                    document.getElementById('hospital-form')?.scrollIntoView({ behavior: 'smooth' });
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
