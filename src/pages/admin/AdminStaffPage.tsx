import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { collection, query, where } from 'firebase/firestore';
import { COLLECTIONS, type StaffDoc } from '@shared/contracts';
import { phMobile } from '@shared/schemas';
import type { Role } from '@shared/types';
import { useAuth } from '@/auth/AuthProvider';
import { useAllClinics } from '@/data/hospitals';
import { db } from '@/lib/firebase';
import { useCollection } from '@/lib/firestore';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { useOnline } from '@/lib/useOnline';
import { Alert, Badge, Button, Card, Loading, PageHeader, SelectField, TextField } from '@/components/ui';

const ROLE_LABELS: Record<Role, string> = { midwife: 'Midwife', clinic_admin: 'Clinic admin', super_admin: 'Super admin' };

const staffSchema = z
  .object({
    name: z.string().trim().min(1, { message: 'Name is required.' }).max(120),
    email: z.string().trim().email({ message: 'Enter a valid email address.' }),
    contactNumber: phMobile,
    role: z.enum(['midwife', 'clinic_admin', 'super_admin']),
    clinicId: z.string(),
  })
  .refine((v) => v.role === 'super_admin' || v.clinicId.length > 0, { message: 'Choose a clinic.', path: ['clinicId'] });

type StaffForm = z.infer<typeof staffSchema>;

export default function AdminStaffPage() {
  const { claims, user } = useAuth();
  const isSuper = claims?.role === 'super_admin';
  const ownClinic = claims?.clinicId ?? null;
  const online = useOnline();
  const clinics = useAllClinics(isSuper);
  const [filterClinic, setFilterClinic] = useState('');
  const [created, setCreated] = useState<{ name: string; link: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const scopeClinic = isSuper ? filterClinic : ownClinic;
  const staffQ = useMemo(() => {
    const col = collection(db, COLLECTIONS.midwives);
    if (scopeClinic) return query(col, where('clinicId', '==', scopeClinic));
    return isSuper ? query(col) : null;
  }, [scopeClinic, isSuper]);
  const staff = useCollection<StaffDoc>(staffQ);
  const rows = useMemo(() => [...staff.data].sort((a, b) => a.name.localeCompare(b.name)), [staff.data]);
  const clinicName = (id: string | null) => (id ? (clinics.data.find((c) => c.id === id)?.name ?? id) : '—');

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(staffSchema),
    defaultValues: { name: '', email: '', contactNumber: '', role: 'midwife', clinicId: isSuper ? '' : (ownClinic ?? '') } as StaffForm,
  });
  const role = useWatch({ control, name: 'role' });

  async function create(v: StaffForm) {
    setCreateError(null);
    setCreated(null);
    setCopied(null);
    try {
      const res = await api.createStaffUser({
        name: v.name,
        email: v.email,
        contactNumber: v.contactNumber,
        role: isSuper ? v.role : 'midwife',
        clinicId: isSuper ? (v.role === 'super_admin' ? null : v.clinicId) : ownClinic,
      });
      setCreated({ name: v.name, link: res.passwordResetLink });
      reset();
    } catch (err) {
      setCreateError(userMessage(err, 'Could not create the account. Please try again.'));
    }
  }

  async function toggle(s: StaffDoc & { id: string }) {
    const next = !s.active;
    if (!next && !window.confirm(`Deactivate ${s.name}? They will be signed out and cannot sign in. Their records are kept.`)) return;
    setBusyUid(s.id);
    setRowError(null);
    try {
      await api.setStaffActive({ uid: s.id, active: next });
    } catch (err) {
      setRowError(userMessage(err, 'Could not update the account. Please try again.'));
    } finally {
      setBusyUid(null);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied('Link copied.');
    } catch {
      setCopied('Could not copy automatically. Press and hold the link to copy it.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Staff accounts" subtitle={isSuper ? 'All clinics' : 'Your clinic'} />
      {!online && <Alert tone="warning">Account changes need an internet connection.</Alert>}

      <Card title={isSuper ? 'Create staff account' : 'Create midwife account'}>
        <form onSubmit={handleSubmit(create)} noValidate className="grid gap-4 md:grid-cols-2">
          <TextField label="Full name" {...register('name')} error={errors.name?.message} />
          <TextField label="Email" type="email" autoComplete="off" {...register('email')} error={errors.email?.message} />
          <TextField label="Mobile number" type="tel" inputMode="tel" placeholder="09XXXXXXXXX" {...register('contactNumber')} error={errors.contactNumber?.message} />
          {isSuper && (
            <SelectField label="Role" {...register('role')} error={errors.role?.message}>
              <option value="midwife">Midwife</option>
              <option value="clinic_admin">Clinic admin</option>
              <option value="super_admin">Super admin</option>
            </SelectField>
          )}
          {isSuper && role !== 'super_admin' && (
            <SelectField label="Clinic" {...register('clinicId')} error={errors.clinicId?.message}>
              <option value="">Choose a clinic…</option>
              {clinics.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          )}
          <div className="md:col-span-2">
            <Button type="submit" disabled={isSubmitting || !online}>
              {isSubmitting ? 'Creating…' : 'Create account'}
            </Button>
          </div>
        </form>
        {createError && (
          <Alert tone="error" className="mt-3">
            {createError}
          </Alert>
        )}
        {created && (
          <div className="mt-3 rounded-lg border-2 border-brand-800 bg-brand-50 p-3">
            <p className="font-bold">Account created for {created.name}.</p>
            <p className="mt-1">Give this password-setup link to the new user. It is shown only once.</p>
            <p className="mt-2 break-all rounded bg-white p-2 font-mono text-sm">{created.link}</p>
            <Button variant="secondary" className="mt-2" onClick={() => copyLink(created.link)}>
              Copy link
            </Button>
            <p aria-live="polite" className="mt-1 text-sm">
              {copied}
            </p>
          </div>
        )}
      </Card>

      <Card title="Accounts">
        {isSuper && (
          <SelectField label="Show clinic" value={filterClinic} onChange={(e) => setFilterClinic(e.target.value)} className="mb-3 max-w-md">
            <option value="">All clinics</option>
            {clinics.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        {rowError && <Alert tone="error">{rowError}</Alert>}
        {staff.error && <Alert tone="error">Could not load staff accounts.</Alert>}
        {staff.loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="text-slate-700">No staff accounts yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {rows.map((s) => {
              const self = s.id === user?.uid;
              const canToggle = !self && (isSuper || s.role === 'midwife');
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="font-bold">
                      {s.name} {self && <span className="font-normal text-slate-700">(you)</span>}
                    </p>
                    <p className="text-sm text-slate-700">
                      {s.email} · {s.contactNumber} · {ROLE_LABELS[s.role]}
                      {isSuper && ` · ${clinicName(s.clinicId)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.active ? <Badge tone="success">Active</Badge> : <Badge>Deactivated</Badge>}
                    {canToggle && (
                      <Button variant={s.active ? 'secondary' : 'primary'} onClick={() => toggle(s)} disabled={busyUid === s.id || !online} aria-label={`${s.active ? 'Deactivate' : 'Reactivate'} ${s.name}`}>
                        {s.active ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
