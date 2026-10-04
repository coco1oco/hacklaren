// Clinic sign-up: creates the owner's email/password account, then registerClinic (server) creates the clinic and
// makes the caller its owner (clinic_admin). The owner then creates staff accounts in Admin → Staff accounts.
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { clinicRegistrationSchema, type ClinicRegistrationInput } from '@shared/schemas';
import { auth } from '@/lib/firebase';
import { api } from '@/lib/api';
import { authMessage, serverMessage } from '@/lib/errors';
import { hardLogout } from '@/lib/session';
import { refreshClaims, useAuth } from '@/auth/AuthProvider';
import { Alert, Button, Card, Loading, TextField } from '@/components/ui';
import { AuthShell } from './AuthShell';

type Errors = Partial<Record<string, string>>;

const EMPTY: ClinicRegistrationInput = {
  clinic: { name: '', address: '', barangay: '', city: '', province: '', contactNumber: '' },
  adminName: '',
  adminContactNumber: '',
};

export default function SignupClinicPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<ClinicRegistrationInput>(EMPTY);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ clinicName: string } | null>(null);

  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (done) {
    return (
      <AuthShell title="Clinic registered">
        <Alert tone="success" className="mt-3" title={`${done.clinicName} is ready.`}>
          You are the clinic owner.
        </Alert>
        <Card className="mt-4" title="Next: add your staff">
          <p className="text-slate-800">
            Go to <strong>Admin → Staff accounts</strong> to create an account for each midwife. You set their email and password, and they sign in with
            exactly those details.
          </p>
        </Card>
        <Button className="mt-4 w-full" onClick={() => navigate('/dashboard', { replace: true })}>
          Go to dashboard
        </Button>
      </AuthShell>
    );
  }
  if (status === 'signedIn' && !busy) return <Navigate to="/dashboard" replace />;

  // A signed-in email account without a clinic (e.g. an earlier attempt failed after the account was created).
  const accountExists = status === 'unassigned' && !!user?.email;

  const set = (path: string, value: string) =>
    setForm((f) => (path.startsWith('clinic.') ? { ...f, clinic: { ...f.clinic, [path.slice(7)]: value } } : { ...f, [path]: value }));
  const field = (path: string) => ({
    value: path.startsWith('clinic.') ? form.clinic[path.slice(7) as keyof ClinicRegistrationInput['clinic']] : (form[path as 'adminName'] as string),
    onChange: (e: { target: { value: string } }) => set(path, e.target.value),
    error: errors[path],
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const parsed = clinicRegistrationSchema.safeParse(form);
    const errs: Errors = {};
    if (!parsed.success) for (const issue of parsed.error.issues) errs[issue.path.join('.')] ??= issue.message;
    if (!accountExists) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'Enter a valid email address.';
      if (password.length < 8) errs.password = 'Use at least 8 characters.';
      if (confirm !== password) errs.confirm = 'Passwords do not match.';
    }
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;

    setBusy(true);
    try {
      if (!accountExists) {
        try {
          await createUserWithEmailAndPassword(auth, email.trim(), password);
        } catch (err) {
          setError(authMessage(err));
          return;
        }
      }
      await api.registerClinic(parsed.data);
      await refreshClaims();
      setDone({ clinicName: parsed.data.clinic.name });
    } catch (err) {
      setError(serverMessage(err, 'Unable to register the clinic. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Register your clinic">
      <p className="mt-1 text-slate-700">Create your clinic and its owner account. As the owner, you create the accounts for your staff.</p>
      <form onSubmit={submit} noValidate className="mt-4 space-y-4">
        <Card title="Clinic">
          <div className="space-y-4">
            <TextField label="Clinic name" placeholder="e.g. Rosa Lying-In Clinic" {...field('clinic.name')} />
            <TextField label="Clinic address" placeholder="e.g. 12 Sampaguita St., Poblacion" {...field('clinic.address')} />
            <TextField label="Barangay" placeholder="e.g. San Isidro" {...field('clinic.barangay')} />
            <TextField label="City / municipality" placeholder="e.g. Malolos" {...field('clinic.city')} />
            <TextField label="Province" placeholder="e.g. Bulacan" {...field('clinic.province')} />
            <TextField label="Clinic phone number" type="tel" inputMode="tel" placeholder="e.g. 09171234567 or (044) 123-4567" {...field('clinic.contactNumber')} />
          </div>
        </Card>
        <Card title="Clinic owner (you)">
          <div className="space-y-4">
            <TextField label="Your name" autoComplete="name" placeholder="e.g. Liza Cruz" {...field('adminName')} />
            <TextField label="Your mobile number" type="tel" inputMode="tel" placeholder="09XXXXXXXXX" {...field('adminContactNumber')} />
            {accountExists ? (
              <p className="text-slate-800">
                Signed in as <strong>{user?.email}</strong>.{' '}
                <button type="button" className="font-semibold text-brand-800 underline" onClick={() => void hardLogout()}>
                  Use a different account
                </button>
              </p>
            ) : (
              <>
                <TextField label="Email" type="email" autoComplete="username" inputMode="email" placeholder="e.g. admin@yourclinic.ph" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
                <TextField label="Password" type="password" autoComplete="new-password" hint="At least 8 characters." value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
                <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
              </>
            )}
          </div>
        </Card>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Registering clinic…' : 'Register clinic'}
        </Button>
      </form>
      <p className="mt-4">
        Already registered?{' '}
        <Link to="/login" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
