import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Alert, Button, TextField } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setDone(true);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
      if (code === 'auth/network-request-failed') setError('No internet connection. Please try again when you are online.');
      else if (code === 'auth/invalid-email') setError('Enter a valid email address.');
      // Do not reveal whether an account exists.
      else setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">Reset password</h1>
      <p className="mt-2 text-slate-700">Enter your work email. If an account exists, we will send a link to set a new password.</p>
      {done ? (
        <Alert tone="success" className="mt-4">
          If an account exists for this email, a password reset link has been sent. Check your inbox.
        </Alert>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          <TextField label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required error={error ?? undefined} />
          <Button type="submit" className="w-full" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
      <p className="mt-4">
        <Link to="/login" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
