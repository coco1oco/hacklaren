// PUBLIC hospital view (/referral/:token). No Firebase Auth and no staff providers:
// every read/write goes through the token-validated callables getReferralView / updateReferralStatus / generateReferralPdf.
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { HospitalReferralView } from '@shared/contracts';
import type { HospitalAction } from '@shared/referralStatus';
import { STATUS_LABELS } from '@shared/referralStatus';
import { DANGER_SIGN_LABELS, type DangerSigns } from '@shared/types';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { describeGravidaPara, formatDate, formatDateTime, URINE_LABELS } from '@/lib/format';
import { Alert, Badge, Button, TextAreaField, TextField } from '@/components/ui';
import { LinkExpiry } from '@/components/Countdown';
import { StatusStepper } from '@/components/StatusStepper';
import { SummaryContentView } from '@/components/SummaryView';
import { CallLink, PdfButton, TypeBadge } from '@/components/referral/ReferralBits';

const TrendCharts = lazy(() => import('@/charts/TrendCharts'));

type Failure = 'expired' | 'revoked' | 'invalid' | 'rate_limited';

const FAILURE: Record<Failure, { title: string; body: string }> = {
  expired: { title: 'Link expired', body: 'This referral link has expired. Please contact the referring clinic for a new link.' },
  revoked: { title: 'Link revoked', body: 'Referral link revoked. Please contact the referring clinic.' },
  invalid: { title: 'This referral link is not valid', body: 'Referral not found. Check the link or contact the referring clinic.' },
  rate_limited: { title: 'Please wait', body: 'Too many requests. Please wait a minute and try again.' },
};

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type State = { kind: 'loading' } | { kind: 'failed'; reason: Failure } | { kind: 'error'; message: string } | { kind: 'ok'; view: HospitalReferralView };

/** Token failures surfaced by updateReferralStatus / generateReferralPdf as HttpsError.details.reason. */
function tokenFailure(e: unknown): Failure | null {
  if (!e || typeof e !== 'object' || !('details' in e)) return null;
  const d = (e as { details: unknown }).details;
  if (d && typeof d === 'object' && 'reason' in d) {
    const r = (d as { reason: unknown }).reason;
    if (r === 'expired' || r === 'revoked' || r === 'invalid' || r === 'rate_limited') return r;
  }
  return null;
}

const ACTION_LABEL: Record<HospitalAction, string> = { ACKNOWLEDGED: 'ACKNOWLEDGE', DECLINED: 'DECLINE', ARRIVED: 'PATIENT ARRIVED' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-300 bg-white p-4">
      <h2 className="mb-2 text-lg font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <dt className="text-sm font-semibold text-slate-700">{label}</dt>
      <dd className="text-slate-950">{children || '—'}</dd>
    </div>
  );
}

function ListOrNone({ items, none }: { items: string[]; none: string }) {
  if (!items.length) return <p className="text-slate-800">{none}</p>;
  return (
    <ul className="ml-5 list-disc">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}

function dangerSigns(s: DangerSigns | undefined): string[] {
  if (!s) return [];
  return (Object.keys(DANGER_SIGN_LABELS) as (keyof DangerSigns)[]).filter((k) => s[k]).map((k) => DANGER_SIGN_LABELS[k]);
}

export default function HospitalReferralPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<State>(() => (TOKEN_RE.test(token) ? { kind: 'loading' } : { kind: 'failed', reason: 'invalid' }));
  const [busy, setBusy] = useState<HospitalAction | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declineError, setDeclineError] = useState<string | undefined>();
  const [actorName, setActorName] = useState('');
  const [announce, setAnnounce] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!TOKEN_RE.test(token)) {
      setState({ kind: 'failed', reason: 'invalid' });
      return;
    }
    try {
      const res = await api.getReferralView({ token });
      setState(res.ok ? { kind: 'ok', view: res.view } : { kind: 'failed', reason: res.reason });
    } catch (e) {
      const f = tokenFailure(e);
      if (f) setState({ kind: 'failed', reason: f });
      else setState({ kind: 'error', message: userMessage(e, 'The referral is not available right now. Please check your connection and try again.') });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: HospitalAction) {
    if (state.kind !== 'ok') return;
    if (action === 'DECLINED' && declineReason.trim().length < 3) {
      setDeclineError('A decline reason is required (at least 3 characters).');
      return;
    }
    setDeclineError(undefined);
    setActionError(null);
    setBusy(action);
    try {
      const res = await api.updateReferralStatus({
        token,
        status: action,
        ...(action === 'DECLINED' ? { declineReason: declineReason.trim() } : {}),
        ...(actorName.trim() ? { actorName: actorName.trim().slice(0, 120) } : {}),
      });
      setDeclineOpen(false);
      setAnnounce(`Status updated: ${STATUS_LABELS[res.status]}.`);
      await load();
    } catch (e) {
      const f = tokenFailure(e);
      if (f && f !== 'rate_limited') setState({ kind: 'failed', reason: f });
      else setActionError(userMessage(e, 'Unable to update the referral status. Please check your connection and try again.'));
    } finally {
      setBusy(null);
    }
  }

  function pdfError(e: unknown): string {
    const f = tokenFailure(e);
    if (f && f !== 'rate_limited') {
      setState({ kind: 'failed', reason: f });
      return FAILURE[f].body;
    }
    return userMessage(e, 'Unable to generate the PDF. Please try again.');
  }

  const shell = (children: ReactNode, bottom?: ReactNode) => (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-300 bg-white px-4 py-3">
        <p className="text-xl font-extrabold text-brand-800">MARA</p>
        <p className="text-sm text-slate-700">Maternal referral: hospital view</p>
      </header>
      <main className={`mx-auto grid max-w-3xl gap-4 px-4 py-4 ${bottom ? 'pb-72 sm:pb-56' : ''}`}>{children}</main>
      {bottom}
    </div>
  );

  if (state.kind === 'loading') {
    return shell(
      <p role="status" className="p-4">
        Loading referral…
      </p>,
    );
  }
  if (state.kind === 'failed') {
    const f = FAILURE[state.reason];
    return shell(
      <Alert tone={state.reason === 'rate_limited' ? 'warning' : 'error'} title={f.title}>
        <p>{f.body}</p>
        {state.reason === 'rate_limited' && (
          <Button variant="secondary" className="mt-2" onClick={() => void load()}>
            Try again
          </Button>
        )}
      </Alert>,
    );
  }
  if (state.kind === 'error') {
    return shell(
      <Alert tone="error" title="Referral not available">
        <p>{state.message}</p>
        <Button variant="secondary" className="mt-2" onClick={() => void load()}>
          Try again
        </Button>
      </Alert>,
    );
  }

  const v = state.view;
  const ref = v.referral;
  const allowed = ref.allowedActions;
  const notes = v.visits.filter((x) => x.notes?.trim());

  const actionBar = (
    <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t-2 border-slate-400 bg-white p-3 shadow-lg">
      <div className="mx-auto grid max-w-3xl gap-2">
        {allowed.length > 0 && (
          <TextField label="Your name / role (optional)" value={actorName} maxLength={120} onChange={(e) => setActorName(e.target.value)} autoComplete="name" />
        )}
        {declineOpen && allowed.includes('DECLINED') && (
          <div className="grid gap-2 rounded-lg border-2 border-red-700 p-2">
            <TextAreaField
              label="Decline reason (required)"
              rows={2}
              maxLength={1000}
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              error={declineError}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="danger" disabled={busy !== null} onClick={() => void act('DECLINED')} className="min-h-14 text-lg font-extrabold">
                {busy === 'DECLINED' ? 'Sending…' : 'SUBMIT DECLINE'}
              </Button>
              <Button variant="secondary" disabled={busy !== null} onClick={() => setDeclineOpen(false)} className="min-h-14">
                Back
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {allowed.includes('ACKNOWLEDGED') && (
            <Button disabled={busy !== null} onClick={() => void act('ACKNOWLEDGED')} className="min-h-14 text-lg font-extrabold">
              {ACTION_LABEL.ACKNOWLEDGED}
            </Button>
          )}
          {allowed.includes('ARRIVED') && (
            <Button disabled={busy !== null} onClick={() => void act('ARRIVED')} className="min-h-14 text-lg font-extrabold">
              {ACTION_LABEL.ARRIVED}
            </Button>
          )}
          {allowed.includes('DECLINED') && !declineOpen && (
            <Button variant="danger" disabled={busy !== null} onClick={() => setDeclineOpen(true)} className="min-h-14 text-lg font-extrabold">
              {ACTION_LABEL.DECLINED}
            </Button>
          )}
          <CallLink phone={v.midwife.contactNumber} label="CALL REFERRING MIDWIFE" className="min-h-14" />
          <PdfButton request={{ token }} errorMessage={pdfError} className="[&_button]:min-h-14 [&_button]:text-lg [&_button]:font-extrabold" />
        </div>
        {busy && <p className="text-sm">Updating…</p>}
        {actionError && <p className="font-semibold text-red-800">{actionError}</p>}
      </div>
    </div>
  );

  return shell(
    <>
      <p aria-live="polite" className={announce ? 'rounded-lg border-l-4 border-green-700 bg-green-50 p-3 font-semibold text-green-950' : 'sr-only'}>
        {announce}
      </p>

      <div className="rounded-xl border-2 border-slate-400 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={ref.type} />
          <Badge tone="neutral">{STATUS_LABELS[ref.status]}</Badge>
        </div>
        <h1 className="mt-2 text-2xl font-bold">
          {v.patient.name} <span className="text-base font-normal text-slate-700">→ {v.hospital.name}</span>
        </h1>
        <div className="mt-2">
          <StatusStepper type={ref.type} status={ref.status} history={ref.statusHistory.map((h) => h.status)} />
        </div>
        <div className="mt-2">
          <LinkExpiry expiresAtMillis={ref.linkExpiresAtMillis} />
        </div>
        {ref.status === 'DECLINED' && ref.declineReason && <p className="mt-2">Decline reason: {ref.declineReason}</p>}
      </div>

      <Section title="Q Summary">
        {v.summary.content ? (
          <SummaryContentView content={v.summary.content} label={v.summary.label} />
        ) : v.summary.state === 'pending' || v.summary.state === 'generating' ? (
          <p>AI summary is being generated. Review the raw chart below. Reload the page later to see the summary.</p>
        ) : (
          <p className="font-semibold">AI summary unavailable. Review the raw chart below.</p>
        )}
      </Section>

      <Section title="Referral">
        <dl className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Referring clinic">
            {v.clinic.name}
            {v.clinic.address && <span className="block text-sm text-slate-700">{v.clinic.address}</span>}
          </Field>
          <Field label="Clinic contact">{v.clinic.contactNumber}</Field>
          <Field label="Referring midwife">{v.midwife.name}</Field>
          <Field label="Midwife contact">{v.midwife.contactNumber}</Field>
          <Field label="Reason">
            {ref.reason.label && ref.reason.label !== ref.reason.text && <span className="font-semibold">{ref.reason.label}. </span>}
            {ref.reason.text}
          </Field>
          <Field label="Urgency / type">
            {ref.urgency === 'emergency' ? 'Emergency' : 'Routine'} / {ref.type === 'emergency' ? 'Emergency referral' : 'Checkup referral'}
          </Field>
          <Field label="Sent">{formatDateTime(ref.sentAtMillis ?? ref.createdAtMillis)}</Field>
          <Field label="Referral ID">{ref.referralId}</Field>
        </dl>
      </Section>

      <Section title="Patient">
        <dl className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Name">{v.patient.name}</Field>
          <Field label="Patient ID">{v.patient.patientId}</Field>
          <Field label="Birthdate / age">
            {formatDate(v.patient.birthdate)}
            {v.patient.ageYears !== null && ` (${v.patient.ageYears} years)`}
          </Field>
          <Field label="Barangay">{v.patient.barangay}</Field>
          <Field label="Gestational age">
            {v.patient.gestationalAge} ({v.patient.trimester})
          </Field>
          <Field label="LMP / EDD">
            {formatDate(v.patient.pregnancy.lmp)} / {formatDate(v.patient.pregnancy.edd)}
          </Field>
          <Field label="Gravida / Para">
            G{v.patient.pregnancy.gravida} P{v.patient.pregnancy.para}
            <span className="block text-sm font-normal text-slate-700">{describeGravidaPara(v.patient.pregnancy.gravida, v.patient.pregnancy.para)}</span>
          </Field>
          <Field label="Blood type">{v.patient.bloodType}</Field>
        </dl>
        <h3 className="mt-3 font-bold">Medical history</h3>
        <ListOrNone items={v.patient.medicalHistory} none="None recorded." />
        <h3 className="mt-3 font-bold">Obstetric history</h3>
        <ListOrNone items={v.patient.obstetricHistory} none="None recorded." />
      </Section>

      <Section title={`Visit history (${v.visits.length}, newest first)`}>
        {v.visits.length === 0 ? (
          <p>No visits recorded.</p>
        ) : (
          <ol className="grid gap-3">
            {v.visits.map((x) => {
              const signs = dangerSigns(x.dangerSigns);
              return (
                <li key={x.visitId} className="rounded-lg border border-slate-300 p-3">
                  <p className="font-bold">
                    {formatDate(x.visitDate)} <span className="font-normal text-slate-700">· GA {x.gestationalAge}</span>
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                    <Field label="BP">{`${x.bpSystolic}/${x.bpDiastolic} mmHg`}</Field>
                    <Field label="Weight">{`${x.weightKg} kg`}</Field>
                    <Field label="FHR">{x.fhr != null ? `${x.fhr} bpm` : ''}</Field>
                    <Field label="Glucose">{x.glucoseMgDl != null ? `${x.glucoseMgDl} mg/dL` : ''}</Field>
                    <Field label="Fundal height">{x.fundalHeightCm != null ? `${x.fundalHeightCm} cm` : ''}</Field>
                    <Field label="Urine protein">{URINE_LABELS[x.urineProtein] ?? x.urineProtein}</Field>
                    <Field label="Urine glucose">{URINE_LABELS[x.urineGlucose] ?? x.urineGlucose}</Field>
                    <Field label="Danger signs">{signs.length ? signs.join(', ') : 'None recorded'}</Field>
                  </dl>
                  {x.medications.length > 0 && <p className="mt-1 text-sm">Medications: {x.medications.join(', ')}</p>}
                  {x.recordedBy && <p className="mt-1 text-sm text-slate-700">Recorded by {x.recordedBy}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <Section title="Trends">
        <Suspense fallback={<p role="status">Loading charts…</p>}>
          <TrendCharts visits={v.visits} />
        </Suspense>
      </Section>

      {v.riskFlags.length > 0 && (
        <Section title="Recorded values for clinical review">
          <ul className="grid gap-1">
            {v.riskFlags.map((f, i) => (
              <li key={i} className="border-l-4 border-slate-400 pl-3">
                <span className="font-semibold">{f.label}</span> ({formatDate(f.visitDate)}): {f.detail}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Current medications">
        <ListOrNone items={v.currentMedications} none="None recorded at the latest visit." />
      </Section>

      <Section title="Allergies">
        <ListOrNone items={v.patient.allergies} none="No allergies recorded." />
      </Section>

      <Section title="Notes">
        {notes.length === 0 ? (
          <p>No visit notes recorded.</p>
        ) : (
          <ul className="grid gap-2">
            {notes.map((x) => (
              <li key={x.visitId}>
                <span className="font-semibold">{formatDate(x.visitDate)}:</span> <span className="whitespace-pre-line">{x.notes}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-sm text-slate-700">Designed to complement existing referral workflows. Call the referring midwife for any questions.</p>
    </>,
    actionBar,
  );
}
