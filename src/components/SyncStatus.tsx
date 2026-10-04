import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useClinicData, type FailedReferral } from '@/data/ClinicDataProvider';
import { useAuth } from '@/auth/AuthProvider';
import { reapplyConflict } from '@/lib/writes';
import { dismissFailedRequest } from '@/lib/queuedReferrals';
import { removeConflict, type SyncConflict } from '@/lib/syncConflicts';
import { formatDateTime, telHref } from '@/lib/format';
import { useOnline } from '@/lib/useOnline';
import { Alert, Button, Card } from './ui';

export function SyncIndicator() {
  const { pendingCount } = useClinicData();
  const online = useOnline();
  return (
    <p aria-live="polite" className={`font-semibold ${pendingCount ? 'text-amber-800' : 'text-green-800'}`}>
      {pendingCount === 0 ? (
        '✓ Synced'
      ) : (
        <>
          ⚠ {pendingCount} {pendingCount === 1 ? 'item' : 'items'} pending synchronization
          {!online && <span className="font-normal text-slate-700"> (will sync when online)</span>}
        </>
      )}
    </p>
  );
}

function payloadPreview(p: Record<string, unknown>): [string, string][] {
  return Object.entries(p)
    .filter(([k]) => !['clinicId', 'createdBy', 'updatedBy', 'version', 'nameLower'].includes(k))
    .map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)]);
}

const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Field-level view for patient edits: the value the edit started from, the current record, and the rejected edit. */
function PatientUpdateDiff({ c }: { c: SyncConflict }) {
  const { patients } = useClinicData();
  const current = patients.find((p) => p.patientId === c.patientId) as unknown as Record<string, unknown> | undefined;
  const fields = Object.keys(c.payload).filter((k) => k !== 'nameLower');
  const currentValue = (k: string) =>
    current ? (k === 'consent' ? { dataSharingForReferral: (current.consent as { dataSharingForReferral?: boolean } | undefined)?.dataSharingForReferral ?? false } : current[k]) : undefined;
  return (
    <div className="mt-2 overflow-x-auto text-sm">
      <table className="w-full text-left">
        <caption className="sr-only">Changed fields</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before your edit</th>
            <th scope="col">Current record</th>
            <th scope="col">Your edit</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((k) => (
            <tr key={k} className="border-t border-amber-300 align-top">
              <th scope="row" className="pr-2 font-semibold">
                {k}
              </th>
              <td className="break-all pr-2">{c.base ? show(c.base[k]) : 'Unknown'}</td>
              <td className="break-all pr-2">{current ? show(currentValue(k)) : 'Not available on this device'}</td>
              <td className="break-all font-semibold">{show(c.payload[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1">“Re-apply as new edit” writes only these fields on top of the current record.</p>
    </div>
  );
}

function ConflictItem({ c }: { c: SyncConflict }) {
  const { ctx } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reapply() {
    if (!ctx) return;
    setBusy(true);
    setError(null);
    try {
      await reapplyConflict(ctx, c);
      removeConflict(c.id);
    } catch {
      setError('Could not re-apply. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    if (window.confirm('Discard this unsynced change? The data in it will be permanently lost.')) removeConflict(c.id);
  }

  return (
    <li className="rounded-lg border border-amber-500 bg-amber-50 p-3">
      <p className="font-bold">{c.label}</p>
      <p className="text-sm">Attempted {formatDateTime(c.attemptedAt)}</p>
      <p className="text-sm">{c.error}</p>
      {c.patientId && (
        <Link className="text-sm font-semibold text-brand-800 underline" to={`/patients/${c.patientId}`}>
          Open current patient record
        </Link>
      )}
      <details className="mt-2 text-sm" open={c.kind === 'patient_update'}>
        <summary className="cursor-pointer py-2 font-semibold">{c.kind === 'patient_update' ? 'Compare changed fields' : 'Show the attempted data'}</summary>
        {c.kind === 'patient_update' ? (
          <PatientUpdateDiff c={c} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3">
            {payloadPreview(c.payload).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-semibold">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </details>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={reapply} disabled={busy}>
          {busy ? 'Re-applying…' : 'Re-apply as new edit'}
        </Button>
        <Button variant="secondary" onClick={discard} disabled={busy}>
          Discard
        </Button>
      </div>
      {error && <p className="mt-1 font-semibold text-red-800">{error}</p>}
    </li>
  );
}

export function SyncConflictsPanel() {
  const { conflicts } = useClinicData();
  if (!conflicts.length) return null;
  return (
    <Card title="Sync conflict requires review" className="border-amber-500">
      <p className="mb-2">These changes were saved on this device but the server did not accept them. Nothing has been deleted. Review each one.</p>
      <ul className="space-y-3">
        {conflicts.map((c) => (
          <ConflictItem key={c.id} c={c} />
        ))}
      </ul>
    </Card>
  );
}

/** One failed offline emergency request: the hospital has NOT received it. */
export function FailedReferralItem({ f, onRetry }: { f: FailedReferral; onRetry?: () => void }) {
  const navigate = useNavigate();
  return (
    <li className="rounded-lg border-2 border-red-700 bg-red-50 p-3">
      <p className="font-bold text-red-900">
        {f.patientName}
        {f.hospitalName ? ` → ${f.hospitalName}` : ''}
        {f.reasonLabel ? ` (${f.reasonLabel})` : ''}
      </p>
      <p className="mt-1 font-semibold text-red-900">
        Referral NOT sent: {f.error}. Call the hospital and create the referral again.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {f.hospitalPhone && (
          <a className="inline-flex min-h-12 items-center rounded-lg bg-red-700 px-4 font-bold text-white" href={telHref(f.hospitalPhone)}>
            CALL HOSPITAL
          </a>
        )}
        <Button variant="danger" onClick={() => (onRetry ? onRetry() : navigate(`/patients/${f.patientId}/referral/emergency`))}>
          Retry referral
        </Button>
        <Button variant="secondary" onClick={() => dismissFailedRequest(f.clientRequestId)}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

export function FailedReferralsPanel({ patientId }: { patientId?: string } = {}) {
  const { failedRequests } = useClinicData();
  const list = patientId ? failedRequests.filter((f) => f.patientId === patientId) : failedRequests;
  if (!list.length) return null;
  return (
    <section role="alert" aria-label="Emergency referrals not sent" className="rounded-xl border-2 border-red-700 bg-white p-4">
      <h2 className="text-lg font-extrabold text-red-900">
        {list.length === 1 ? 'An emergency referral was NOT sent' : `${list.length} emergency referrals were NOT sent`}
      </h2>
      <ul className="mt-2 space-y-2">
        {list.map((f) => (
          <FailedReferralItem key={f.clientRequestId} f={f} />
        ))}
      </ul>
    </section>
  );
}

export function QueuedReferralsPanel() {
  const { queued } = useClinicData();
  if (!queued.length) return null;
  return (
    <Card title="Emergency referrals waiting for connection">
      <Alert tone="warning">
        These referrals have not reached the hospital yet. They will be transmitted automatically when connectivity returns. Call the hospital now.
      </Alert>
      <ul className="mt-3 space-y-2">
        {queued.map((q) => (
          <li key={q.clientRequestId} className="rounded-lg border border-slate-300 p-3">
            <p className="font-bold">
              {q.patientName} → {q.hospitalName}
            </p>
            <p className="text-sm">
              {q.reasonLabel} · queued {formatDateTime(q.queuedAt)}
            </p>
            <a className="mt-2 inline-flex min-h-12 items-center rounded-lg bg-red-700 px-4 font-bold text-white" href={telHref(q.hospitalPhone)}>
              CALL HOSPITAL
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
