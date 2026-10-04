import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { hardLogout, sessionTimeoutMs } from '@/lib/session';
import { authMessage } from '@/lib/errors';
import { useClinicData } from '@/data/ClinicDataProvider';
import { Button, TextField } from '@/components/ui';
import { useAuth } from './AuthProvider';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
const DEACTIVATED_MSG = 'Your account has been deactivated. Please contact your clinic administrator.';

/**
 * Idle session timeout and account deactivation. With no unsynced data: full logout (cache wiped).
 * With unsynced data (pending writes, outbox entries, conflicts): lock the screen instead, so clinical data is not destroyed.
 */
export function SessionGuard({ children }: { children: ReactNode }) {
  const { unsyncedCount: unsynced } = useClinicData();
  const { deactivated } = useAuth();
  const [locked, setLocked] = useState(false);
  const last = useRef(Date.now());
  const timeout = sessionTimeoutMs();

  const onIdle = useCallback(() => {
    const minutes = Math.round(timeout / 60_000);
    if (unsynced > 0) setLocked(true);
    else void hardLogout(`You were signed out after ${minutes} minutes of inactivity.`);
  }, [timeout, unsynced]);

  useEffect(() => {
    if (deactivated && unsynced === 0) void hardLogout(DEACTIVATED_MSG);
  }, [deactivated, unsynced]);

  useEffect(() => {
    const mark = () => {
      last.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const check = () => {
      if (!locked && Date.now() - last.current >= timeout) onIdle();
    };
    const t = window.setInterval(check, 15_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', check);
    };
  }, [locked, timeout, onIdle]);

  const showLock = locked || deactivated;
  return (
    <>
      <div inert={showLock} aria-hidden={showLock || undefined} className={showLock ? 'hidden' : undefined}>
        {children}
      </div>
      {deactivated ? (
        <DeactivatedScreen unsynced={unsynced} />
      ) : (
        locked && (
          <LockScreen
            unsynced={unsynced}
            onUnlock={() => {
              last.current = Date.now();
              setLocked(false);
            }}
          />
        )
      )}
    </>
  );
}

function LogoutAnyway({ unsynced, message }: { unsynced: number; message?: string }) {
  return (
    <Button
      variant="secondary"
      className="mt-6 w-full"
      onClick={() => {
        if (window.confirm(`Log out anyway? ${unsynced} unsynchronized item(s) on this device will be permanently lost.`)) void hardLogout(message);
      }}
    >
      Log out anyway
    </Button>
  );
}

function DeactivatedScreen({ unsynced }: { unsynced: number }) {
  return (
    <main className="mx-auto max-w-md p-6" role="alert">
      <h1 className="text-2xl font-bold">Account deactivated</h1>
      <p className="mt-2">Your account has been deactivated, so you cannot continue working in MARA.</p>
      {unsynced > 0 && (
        <p className="mt-2">
          {unsynced} {unsynced === 1 ? 'item on this device has' : 'items on this device have'} not synchronized with the server. They were not deleted. Keep this
          device connected and ask your clinic administrator to help sync or record this data before you log out.
        </p>
      )}
      <LogoutAnyway unsynced={unsynced} message={DEACTIVATED_MSG} />
    </main>
  );
}

function LockScreen({ unsynced, onUnlock }: { unsynced: number; onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const email = auth.currentUser?.email ?? '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !email) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
      onUnlock();
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-bold">Session locked</h1>
      <p className="mt-2">
        The screen was locked after a period of inactivity. {unsynced} {unsynced === 1 ? 'item has' : 'items have'} not synchronized yet, so you were not signed
        out. Enter your password to continue.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <p>
          Signed in as <strong>{email}</strong>
        </p>
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error ?? undefined} required />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Checking…' : 'Unlock'}
        </Button>
      </form>
      <LogoutAnyway unsynced={unsynced} />
    </main>
  );
}
