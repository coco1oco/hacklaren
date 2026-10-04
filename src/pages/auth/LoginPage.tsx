import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { authMessage } from '@/lib/errors';
import { takeLogoutMessage } from '@/lib/session';
import { onboardingPath, useAuth } from '@/auth/AuthProvider';
import { Alert, Button, ButtonLink, Loading, TextField } from '@/components/ui';
import { OfflineBanner } from '@/components/Layout';

// Read once per page load (logout always reloads), so StrictMode double renders cannot lose it.
const logoutMessage = takeLogoutMessage();

export default function LoginPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (status === 'signedIn') return <Navigate to={from && from !== '/login' ? from : '/dashboard'} replace />;
  if (status === 'unassigned') return <Navigate to={onboardingPath(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(from && from !== '/login' ? from : '/dashboard', { replace: true });
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <OfflineBanner />
      <main id="main" className="mx-auto max-w-md p-6">
        <h1 className="text-3xl font-extrabold text-brand-800">MARA</h1>
        <p className="text-slate-700">Maternal Referral and Admission</p>
        <h2 className="mt-6 text-xl font-bold">Sign in</h2>
        {logoutMessage && (
          <Alert tone="info" className="mt-3">
            {logoutMessage}
          </Alert>
        )}
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <TextField label="Email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4">
          <Link to="/forgot-password" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline">
            Forgot password?
          </Link>
        </p>
        <div className="mt-6 grid gap-3 border-t border-slate-200 pt-6">
          <div>
            <p className="font-semibold text-slate-900">Clinic staff</p>
            <p className="text-sm text-slate-700">Sign in, or join your clinic for the first time with your mobile number and the clinic server code.</p>
            <ButtonLink to="/join" variant="secondary" className="mt-2 w-full">
              Join with your mobile number
            </ButtonLink>
          </div>
          <div>
            <p className="font-semibold text-slate-900">New clinic?</p>
            <ButtonLink to="/signup" variant="secondary" className="mt-2 w-full">
              Register your clinic
            </ButtonLink>
          </div>
        </div>
        <p className="mt-6 text-sm text-slate-600">Designed to complement existing referral workflows.</p>
      </main>
    </>
  );
}
