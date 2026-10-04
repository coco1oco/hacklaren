import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { Alert, Button, Card } from './ui';

/** Large, readable server code with a copy button. */
export function ServerCodeDisplay({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="rounded-lg bg-slate-100 px-4 py-2 font-mono text-3xl font-extrabold tracking-widest text-slate-950" aria-label={`Server code ${code.split('').join(' ')}`}>
        {code}
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => setCopied(true));
        }}
      >
        {copied ? 'Copied' : 'Copy code'}
      </Button>
    </div>
  );
}

/** Clinic admin card: shows the clinic server code and lets the admin replace it (the old code stops working). */
export function ClinicServerCodeCard({ clinicId = null }: { clinicId?: string | null }) {
  const [state, setState] = useState<{ code: string; createdAtMillis: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getClinicJoinCode({ clinicId })
      .then((r) => !cancelled && setState(r))
      .catch((e) => !cancelled && setError(userMessage(e, 'Unable to load the clinic server code.')));
    return () => {
      cancelled = true;
    };
  }, [clinicId]);

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      setState(await api.rotateClinicJoinCode({ clinicId }));
      setConfirming(false);
    } catch (e) {
      setError(userMessage(e, 'Unable to generate a new server code.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Clinic server code">
      <p className="mb-3 text-slate-800">
        Staff join your clinic by verifying their mobile number and entering this code. Share it only with your own staff. New members appear under Staff
        accounts, where you can deactivate anyone who should not have access.
      </p>
      {state ? (
        <>
          <ServerCodeDisplay code={state.code} />
          <p className="mt-2 text-sm text-slate-700">Issued {formatDateTime(state.createdAtMillis)}</p>
        </>
      ) : (
        !error && <p role="status">Loading code…</p>
      )}
      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3" aria-live="polite">
        {confirming ? (
          <div className="grid gap-2 rounded-lg border-2 border-amber-600 p-3">
            <p className="font-semibold">The current code will stop working immediately. People who already joined keep their access.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => void rotate()} disabled={busy}>
                {busy ? 'Generating…' : 'Yes, generate new code'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)} disabled={!state}>
            Generate new code
          </Button>
        )}
      </div>
    </Card>
  );
}
