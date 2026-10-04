// Staff sign-in / join with a mobile number:
//  1. enter mobile number → Firebase Phone Auth sends an SMS code (OTP)
//  2. enter the code → signed in
//  3. first time only: enter your name + the clinic server code → joinClinic (server) grants the midwife role
// Returning staff who already joined go straight to the dashboard after step 2.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { joinCodeSchema, phMobile } from '@shared/schemas';
import { auth, usingEmulators } from '@/lib/firebase';
import { api } from '@/lib/api';
import { authMessage, serverMessage } from '@/lib/errors';
import { hardLogout } from '@/lib/session';
import { onboardingPath, refreshClaims, useAuth } from '@/auth/AuthProvider';
import { Alert, Button, Loading, TextField } from '@/components/ui';
import { AuthShell } from './AuthShell';

/** 09171234567 / +639171234567 → +639171234567 (E.164, required by Firebase Phone Auth). */
function toE164(mobile: string): string {
  const s = mobile.trim().replace(/[\s-]/g, '');
  return s.startsWith('+63') ? s : `+63${s.replace(/^0/, '')}`;
}

export default function JoinClinicPage() {
  const { status, user } = useAuth();
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(
    () => () => {
      verifier.current?.clear();
      verifier.current = null;
    },
    [],
  );

  if (status === 'loading') return <Loading label="Checking your session…" />;
  if (status === 'signedIn' && !busy) return <Navigate to="/dashboard" replace state={joined ? { welcome: joined } : undefined} />;
  if (status === 'unassigned' && !user?.phoneNumber) return <Navigate to={onboardingPath(user)} replace />;

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const parsed = phMobile.safeParse(mobile);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      verifier.current ??= new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      setConfirmation(await signInWithPhoneNumber(auth, toE164(parsed.data), verifier.current));
    } catch (err) {
      verifier.current?.clear();
      verifier.current = null;
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (!confirmation) return;
    if (!/^\d{6}$/.test(otp.trim())) {
      setFieldError('Enter the 6-digit code from the SMS.');
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      // On success the auth listener decides: existing staff → dashboard; new number → server-code step.
      await confirmation.confirm(otp.trim());
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    const parsedCode = joinCodeSchema.safeParse(code);
    if (!name.trim()) {
      setFieldError('Enter your name.');
      return;
    }
    if (!parsedCode.success) {
      setFieldError(parsedCode.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      const res = await api.joinClinic({ code: parsedCode.data, name: name.trim() });
      setJoined(res.clinicName);
      await refreshClaims();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(serverMessage(err, 'Unable to join the clinic. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 3: signed in with a verified number, not yet in a clinic ────────────
  if (status === 'unassigned') {
    return (
      <AuthShell title="Join your clinic">
        <p className="mt-1 text-slate-700">
          Mobile number verified: <strong>{user?.phoneNumber}</strong>. Ask your clinic administrator for the clinic server code.
        </p>
        <form onSubmit={join} noValidate className="mt-4 space-y-4">
          <TextField label="Your name" autoComplete="name" placeholder="e.g. Ana Reyes" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Clinic server code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. ROSA-2841"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="font-mono"
          />
          {fieldError && <Alert tone="error">{fieldError}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Joining…' : 'Join clinic'}
          </Button>
        </form>
        <p className="mt-4">
          <button type="button" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline" onClick={() => void hardLogout()}>
            Use a different mobile number
          </button>
        </p>
      </AuthShell>
    );
  }

  // ── Steps 1–2: verify the mobile number ──────────────────────────────────────
  return (
    <AuthShell title="Sign in or join with your mobile number">
      <p className="mt-1 text-slate-700">For clinic staff. We send a one-time code by SMS to verify your number.</p>
      {!confirmation ? (
        <form onSubmit={sendCode} noValidate className="mt-4 space-y-4">
          <TextField
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="09XXXXXXXXX"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            error={fieldError}
          />
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy || !mobile}>
            {busy ? 'Sending code…' : 'Send code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} noValidate className="mt-4 space-y-4">
          <p className="text-slate-800">
            Code sent to <strong>{mobile}</strong>.
          </p>
          <TextField
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="e.g. 123456"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            error={fieldError}
          />
          {usingEmulators && <p className="text-sm text-slate-700">Development: the code is shown in the Firebase emulator log.</p>}
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" className="w-full" disabled={busy || otp.length !== 6}>
            {busy ? 'Verifying…' : 'Verify'}
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => {
              setConfirmation(null);
              setOtp('');
              setError(null);
            }}
          >
            Change number / resend code
          </Button>
        </form>
      )}
      <div id="recaptcha-container" />
      <p className="mt-4">
        <Link to="/login" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline">
          Sign in with email instead
        </Link>
      </p>
    </AuthShell>
  );
}
