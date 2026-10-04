import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ReferralLinkResult } from '@shared/contracts';
import type { EmergencyReferralInput } from '@shared/schemas';
import { EMERGENCY_REASONS } from '@shared/types';
import { rankHospitals, type LatLng } from '@shared/geo';
import { api } from '@/lib/api';
import { isNetworkError, userMessage } from '@/lib/errors';
import { addQueued, dismissedFailedStore } from '@/lib/queuedReferrals';
import { FailedReferralItem } from '@/components/SyncStatus';
import { queueEmergencyRequest } from '@/lib/writes';
import { Alert, Button, ButtonLink, Card, Loading, PageHeader, TextAreaField } from '@/components/ui';
import { LinkPanel } from '@/components/LinkPanel';
import { StatusStepper } from '@/components/StatusStepper';
import { HospitalPicker } from '@/components/referral/HospitalPicker';
import { CallHospitalPanel } from '@/components/referral/ReferralBits';
import { ReferralSlip } from '@/components/referral/ReferralSlip';
import { useCurrentPosition } from '@/components/referral/hooks';
import { usePatientReferralContext } from './_lib/usePatientContext';

const SEND_FAILED = 'Unable to send referral. Your patient record has not been lost. Please check your connection and try again.';
const OFFLINE_MSG = 'No internet connection. The referral will be transmitted automatically when connectivity returns.';
const ALREADY_CREATED = 'This referral was already created. Use “Resend link” on the referral page to get a hospital link.';

type Phase =
  | { kind: 'form' }
  | { kind: 'sent'; referralId: string; link: ReferralLinkResult | null; deduplicated: boolean }
  | { kind: 'queued'; queuedAt: number };

export default function EmergencyReferralPage() {
  const { patientId } = useParams();
  const { ctx, staff, data, patient, hospitals, visits } = usePatientReferralContext(patientId);
  const position = useCurrentPosition();

  const [hospitalId, setHospitalId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  // One idempotency key per referral attempt; reused on retry so the server never duplicates it.
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const dismissedFailed = dismissedFailedStore.useValue();
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ hospital?: string; reason?: string; text?: string }>({});

  const clinicLat = data.clinic?.latitude ?? null;
  const clinicLng = data.clinic?.longitude ?? null;
  const clinicOrigin = useMemo<LatLng | null>(
    () => (clinicLat !== null && clinicLng !== null ? { latitude: clinicLat, longitude: clinicLng } : null),
    [clinicLat, clinicLng],
  );
  const origin = position.status === 'ok' ? position.position : clinicOrigin;
  const ranked = useMemo(() => rankHospitals(hospitals.data.filter((h) => h.active), origin), [hospitals.data, origin]);
  const selected = hospitals.data.find((h) => h.id === hospitalId) ?? null;

  // Realtime referral doc (from the clinic-scoped listener). Matches by clientRequestId so a queued request resolves too.
  const referral = data.referrals.find((r) => r.clientRequestId === clientRequestId) ?? null;
  // The server could not process the queued request: the hospital has NOT received it.
  const failedHere = data.failedRequests.find((f) => f.clientRequestId === clientRequestId) ?? null;
  const failedDismissed = dismissedFailed.includes(clientRequestId);

  if (!ctx) return <Alert tone="error" title="Clinic staff only">Your account is not assigned to a clinic.</Alert>;
  if (data.patientsLoading && !patient) return <Loading label="Loading patient…" />;
  if (!patient) {
    return (
      <Alert tone="error" title="Patient not found">
        <Link to="/patients" className="underline">
          Back to patients
        </Link>
      </Alert>
    );
  }

  const consentMissing = !patient.consent?.dataSharingForReferral;
  const reasonLabel = EMERGENCY_REASONS.find((r) => r.code === reasonCode)?.label ?? '';

  function validate(): boolean {
    const fe: typeof fieldErrors = {};
    if (!hospitalId) fe.hospital = 'Choose a hospital.';
    if (!reasonCode) fe.reason = 'Choose a reason.';
    if (reasonCode === 'other' && !reasonText.trim()) fe.text = 'Describe the reason when "Other" is selected.';
    if (reasonText.length > 1000) fe.text = 'Keep the description under 1000 characters.';
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  }

  function queue(input: EmergencyReferralInput) {
    if (!ctx || !patient) return;
    queueEmergencyRequest(ctx, input);
    addQueued({
      clientRequestId,
      patientId: patient.patientId,
      patientName: patient.name,
      hospitalName: selected?.name ?? '',
      hospitalPhone: selected?.phone ?? '',
      reasonLabel,
      queuedAt: Date.now(),
    });
    setPhase({ kind: 'queued', queuedAt: Date.now() });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending || !patient || !validate()) return;
    setError(null);
    const input: EmergencyReferralInput = { patientId: patient.patientId, hospitalId, reasonCode, reasonText: reasonText.trim(), clientRequestId };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      queue(input);
      return;
    }
    setSending(true);
    try {
      const res = await api.createReferral({ type: 'emergency', ...input });
      setPhase({ kind: 'sent', referralId: res.referralId, link: res.link, deduplicated: res.deduplicated });
    } catch (err) {
      if (isNetworkError(err)) queue(input);
      else setError(userMessage(err, SEND_FAILED));
    } finally {
      setSending(false);
    }
  }

  const hospitalName = referral?.hospital.name ?? selected?.name ?? '';
  const hospitalPhone = referral?.hospital.phone ?? selected?.phone ?? '';

  // ── After sending ─────────────────────────────────────────────────────────
  if (phase.kind === 'sent' || (phase.kind === 'queued' && referral)) {
    const referralId = phase.kind === 'sent' ? phase.referralId : referral!.referralId;
    const status = referral?.status ?? 'SENT';
    const summaryState = referral?.summary.state ?? 'pending';
    return (
      <div className="grid gap-4">
        <PageHeader title="Emergency referral sent" subtitle={`${patient.name} → ${hospitalName}`} />
        <Card title="Status">
          <StatusStepper type="emergency" status={status} history={referral?.statusHistory.map((h) => h.status) ?? ['SENT']} />
          <p className="mt-2 text-sm text-slate-800">Referral ID: {referralId}</p>
        </Card>
        <CallHospitalPanel hospitalName={hospitalName} phone={hospitalPhone} />
        {phase.kind === 'sent' && phase.link && <LinkPanel link={phase.link} hospitalName={hospitalName} />}
        {phase.kind === 'sent' && !phase.link && <Alert tone="info">{ALREADY_CREATED}</Alert>}
        {phase.kind === 'queued' && (
          <Alert tone="success" title="Referral transmitted">
            {ALREADY_CREATED}
          </Alert>
        )}
        <div aria-live="polite">
          {summaryState === 'failed' ? (
            <Alert tone="warning">AI summary unavailable. The referral remains available. The hospital can review the patient's raw chart.</Alert>
          ) : summaryState === 'ready' || summaryState === 'approved' ? (
            <Alert tone="success">Summary is ready. It is shown to the hospital labelled as not yet reviewed by the midwife.</Alert>
          ) : (
            <Alert tone="info">AI summary is being generated in the background. The referral has already been sent and does not wait for it.</Alert>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to={`/referrals/${referralId}/slip`} variant="secondary">
            PRINT REFERRAL SLIP
          </ButtonLink>
          <ButtonLink to={`/referrals/${referralId}`} variant="secondary">
            Open referral
          </ButtonLink>
        </div>
      </div>
    );
  }

  function retry() {
    setClientRequestId(crypto.randomUUID());
    setPhase({ kind: 'form' });
    setError(null);
  }

  // ── Queued request failed on the server ───────────────────────────────────
  if (phase.kind === 'queued' && (failedHere || failedDismissed)) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Emergency referral NOT sent" subtitle={`${patient.name} → ${hospitalName}`} />
        {failedHere ? (
          <section role="alert" className="rounded-xl border-2 border-red-700 bg-white p-4">
            <ul>
              <FailedReferralItem f={failedHere} onRetry={retry} />
            </ul>
          </section>
        ) : (
          <Alert tone="error" title="Referral NOT sent">
            Call the hospital and create the referral again.
            <div className="mt-2">
              <Button variant="danger" onClick={retry}>
                Retry referral
              </Button>
            </div>
          </Alert>
        )}
        <CallHospitalPanel hospitalName={hospitalName} phone={hospitalPhone} />
      </div>
    );
  }

  // ── Queued offline ────────────────────────────────────────────────────────
  if (phase.kind === 'queued') {
    return (
      <div className="grid gap-4">
        <PageHeader title="Emergency referral queued" subtitle={`${patient.name} → ${hospitalName}`} />
        <Alert tone="warning" title={OFFLINE_MSG}>
          The hospital has NOT received this referral yet. Once it is processed it appears under Referrals; open it and use “Resend link” to get a hospital
          link. Keep this device on and connected.
        </Alert>
        <CallHospitalPanel hospitalName={hospitalName} phone={hospitalPhone} />
        <div className="no-print">
          <Button variant="secondary" onClick={() => window.print()}>
            PRINT REFERRAL SLIP
          </Button>
        </div>
        <ReferralSlip
          data={{
            referralId: null,
            clientRequestId,
            createdAtMillis: phase.queuedAt,
            type: 'emergency',
            urgency: 'emergency',
            clinic: { name: data.clinic?.name ?? '', address: data.clinic?.address ?? '', contactNumber: data.clinic?.contactNumber ?? '' },
            midwife: { name: staff?.name ?? ctx.staffName, contactNumber: staff?.contactNumber ?? '' },
            hospital: { name: selected?.name ?? '', address: selected?.address ?? '', phone: selected?.phone ?? '' },
            patient,
            patientName: patient.name,
            reason: [reasonLabel, reasonText.trim()].filter(Boolean).join(': '),
            visits: visits.data,
          }}
        />
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <PageHeader title="Emergency referral" subtitle={patient.name} />
      {consentMissing && (
        <Alert tone="warning" title="Consent for data sharing is not recorded">
          Emergency referrals may proceed without it. This is recorded in the audit log. Record consent on the patient profile when possible.
        </Alert>
      )}
      <Card>
        <p className="mb-2 text-sm text-slate-800">
          {position.status === 'ok'
            ? 'Sorted by straight-line distance from your current location, then by services.'
            : position.status === 'pending'
              ? 'Finding your location… Hospitals are sorted from the clinic location until then.'
              : clinicOrigin
                ? 'Location unavailable. Sorted by straight-line distance from the clinic.'
                : 'Location unavailable. Sorted by services.'}{' '}
          Distances are approximate and do not indicate travel time.
        </p>
        {hospitals.loading && !hospitals.data.length ? (
          <Loading label="Loading hospitals…" />
        ) : (
          <HospitalPicker
            name="hospital"
            legend="Receiving hospital"
            options={ranked}
            value={hospitalId}
            onChange={setHospitalId}
            showDistance
            error={fieldErrors.hospital}
          />
        )}
      </Card>
      <Card>
        <fieldset aria-describedby={fieldErrors.reason ? 'reason-err' : undefined}>
          <legend className="mb-2 text-lg font-bold text-slate-900">Reason</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {EMERGENCY_REASONS.map((r) => (
              <label
                key={r.code}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 p-3 font-semibold ${reasonCode === r.code ? 'border-brand-800 bg-brand-50' : 'border-slate-300'}`}
              >
                <input
                  type="radio"
                  name="reasonCode"
                  value={r.code}
                  checked={reasonCode === r.code}
                  onChange={() => setReasonCode(r.code)}
                  className="h-6 w-6 accent-brand-800"
                />
                {r.label}
              </label>
            ))}
          </div>
          {fieldErrors.reason && (
            <p id="reason-err" className="mt-1 font-semibold text-red-800">
              {fieldErrors.reason}
            </p>
          )}
        </fieldset>
        <TextAreaField
          className="mt-3"
          label={reasonCode === 'other' ? 'Describe the reason (required)' : 'Additional details (optional)'}
          value={reasonText}
          maxLength={1000}
          placeholder="e.g. Heavy bleeding started 30 minutes ago, soaking 2 pads."
          onChange={(e) => setReasonText(e.target.value)}
          error={fieldErrors.text}
        />
      </Card>
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" variant="danger" disabled={sending} className="min-h-16 w-full text-xl font-extrabold">
        {sending ? 'SENDING…' : 'SEND IMMEDIATELY'}
      </Button>
      <p className="text-sm text-slate-800">The referral is sent right away. The AI summary is prepared afterwards and never delays sending.</p>
      {selected && <CallHospitalPanel hospitalName={selected.name} phone={selected.phone} />}
    </form>
  );
}
