import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ReferralLinkResult } from '@shared/contracts';
import type { QSummaryContent, ReferralStatus } from '@shared/types';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Alert, Button, ButtonLink, Card, CheckboxField, Loading, PageHeader, TextAreaField } from '@/components/ui';
import { LinkPanel } from '@/components/LinkPanel';
import { StatusStepper } from '@/components/StatusStepper';
import { HospitalPicker } from '@/components/referral/HospitalPicker';
import { CallHospitalPanel, PdfButton } from '@/components/referral/ReferralBits';
import { SummaryEditor } from '@/components/referral/SummaryEditor';
import { draftErrors, fromDraft, toDraft, type SummaryDraft } from '@/components/referral/summaryDraft';
import { usePatientReferralContext } from './_lib/usePatientContext';

const AI_FAILED = 'Q summary unavailable. Review the raw chart manually. Retry summary.';
const CREATE_FAILED = 'Unable to create the referral. Your patient record has not been lost. Please check your connection and try again.';
const SEND_FAILED = 'Unable to send referral. Your patient record has not been lost. Please check your connection and try again.';

/** The send response may arrive before the realtime doc shows SENT; append it only if missing. */
function withSent(history: ReferralStatus[]): ReferralStatus[] {
  return history.includes('SENT') ? history : [...history, 'SENT'];
}

export default function CheckupReferralPage() {
  const { patientId } = useParams();
  const [params, setParams] = useSearchParams();
  const { ctx, data, patient, hospitals } = usePatientReferralContext(patientId);

  const referralId = params.get('referralId');
  const [hospitalId, setHospitalId] = useState('');
  const [reason, setReason] = useState(() => (params.get('reason') ?? '').slice(0, 1000));
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState<'create' | 'generate' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ hospital?: string; reason?: string }>({});

  const [generated, setGenerated] = useState<QSummaryContent | null>(null);
  const [aiFailed, setAiFailed] = useState(false);
  const [draft, setDraft] = useState<SummaryDraft | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [sent, setSent] = useState<ReferralLinkResult | null>(null);

  const eligible = useMemo(
    () => hospitals.data.filter((h) => h.active && h.dohNetworked).sort((a, b) => a.name.localeCompare(b.name)).map((hospital) => ({ hospital, distanceKm: null })),
    [hospitals.data],
  );
  const referral = referralId ? (data.referrals.find((r) => r.referralId === referralId || r.id === referralId) ?? null) : null;

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
  const profileHref = `/patients/${patient.patientId}`;

  async function generate(id: string) {
    setBusy('generate');
    setError(null);
    setAiFailed(false);
    try {
      const res = await api.generateSummary({ referralId: id });
      if (res.ok) {
        setGenerated(res.content);
        setDraft(toDraft(res.content));
        setReviewed(false);
      } else {
        setAiFailed(true);
      }
    } catch (e) {
      setAiFailed(true);
      const m = userMessage(e, '');
      if (m) setError(m);
    } finally {
      setBusy(null);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy || !patient) return;
    const fe: typeof fieldErrors = {};
    if (!hospitalId) fe.hospital = 'Choose a hospital.';
    if (!reason.trim()) fe.reason = 'Reason for referral is required.';
    setFieldErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy('create');
    setError(null);
    try {
      const res = await api.createReferral({ type: 'checkup', patientId: patient.patientId, hospitalId, reasonText: reason.trim(), clientRequestId });
      setParams({ referralId: res.referralId }, { replace: true });
      await generate(res.referralId);
    } catch (err) {
      setError(userMessage(err, CREATE_FAILED));
      setBusy(null);
    }
  }

  // ── Step 1: choose hospital + reason ──────────────────────────────────────
  if (!referralId) {
    const consentMissing = !patient.consent?.dataSharingForReferral;
    return (
      <form onSubmit={create} noValidate className="grid gap-4">
        <PageHeader title="Checkup referral" subtitle={patient.name} />
        {consentMissing && (
          <Alert tone="warning" title="Consent for data sharing is not recorded">
            Checkup referrals require the patient's consent. <Link to={profileHref} className="underline">Record consent on the patient profile</Link> first.
          </Alert>
        )}
        <Card>
          {hospitals.loading && !hospitals.data.length ? (
            <Loading label="Loading hospitals…" />
          ) : (
            <HospitalPicker
              name="hospital"
              legend="Receiving hospital (DOH-networked hospitals only)"
              options={eligible}
              value={hospitalId}
              onChange={setHospitalId}
              showDistance={false}
              error={fieldErrors.hospital}
            />
          )}
        </Card>
        <Card>
          <TextAreaField
            label="Reason for referral"
            rows={4}
            placeholder="e.g. BP 148/94 and 155/100 at the last two visits. Requesting OB evaluation."
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={fieldErrors.reason}
            hint="Describe what you observed and what you are asking the hospital to evaluate. Do not state a diagnosis."
          />
        </Card>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" disabled={busy !== null} className="w-full">
          {busy === 'create' ? 'Creating referral…' : 'Create referral & continue'}
        </Button>
      </form>
    );
  }

  // ── Resuming: wait for the referral doc ───────────────────────────────────
  if (!referral) {
    if (data.referralsLoading || busy) return <Loading label="Loading referral…" />;
    return (
      <Alert tone="error" title="Referral not found">
        <Link to="/referrals" className="underline">
          Back to referrals
        </Link>
      </Alert>
    );
  }

  const hospitalName = referral.hospital.name;

  // ── Step 3: sent ──────────────────────────────────────────────────────────
  if (sent || referral.status !== 'CREATED') {
    return (
      <div className="grid gap-4">
        <PageHeader title={sent ? 'Checkup referral sent' : 'Checkup referral'} subtitle={`${patient.name} → ${hospitalName}`} />
        <Card title="Status">
          <StatusStepper type="checkup" status={referral.status === 'CREATED' ? 'SENT' : referral.status} history={referral.status === 'CREATED' ? withSent(referral.statusHistory.map((h) => h.status)) : referral.statusHistory.map((h) => h.status)} />
          <p className="mt-2 text-sm text-slate-800">Referral ID: {referral.referralId}</p>
        </Card>
        {sent ? (
          <LinkPanel link={sent} hospitalName={hospitalName} />
        ) : (
          <Alert tone="info">This referral has already been sent. Open the referral page to manage its link.</Alert>
        )}
        <CallHospitalPanel hospitalName={hospitalName} phone={referral.hospital.phone} />
        <div className="grid gap-2 sm:grid-cols-3">
          <PdfButton request={{ referralId: referral.referralId }} />
          <ButtonLink to={`/referrals/${referral.referralId}/slip`} variant="secondary">
            PRINT REFERRAL SLIP
          </ButtonLink>
          <ButtonLink to={`/referrals/${referral.referralId}`} variant="secondary">
            Open referral
          </ButtonLink>
        </div>
      </div>
    );
  }

  // ── Step 2: Q summary review ─────────────────────────────────────────────
  const s = referral.summary;
  const serverContent = (s.state === 'ready' || s.state === 'approved') && s.content ? s.content : null;
  const content = generated ?? serverContent;
  const effectiveDraft = draft ?? (content ? toDraft(content) : null);
  const generating = busy === 'generate' || (!content && s.state === 'generating');
  const failed = !content && !generating && (aiFailed || s.state === 'failed');
  const errs = effectiveDraft ? draftErrors(effectiveDraft) : {};
  const canSend = !!effectiveDraft && reviewed && Object.keys(errs).length === 0 && busy === null;

  async function send() {
    if (!effectiveDraft || !referral) return;
    setBusy('send');
    setError(null);
    try {
      const res = await api.sendReferral({ referralId: referral.referralId, approvedSummary: fromDraft(effectiveDraft) });
      setSent(res.link);
    } catch (e) {
      setError(userMessage(e, SEND_FAILED));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader title="Review Q summary" subtitle={`${patient.name} → ${hospitalName}`} />
      <Card title="Status">
        <StatusStepper type="checkup" status="CREATED" history={['CREATED']} />
        <p className="mt-2 text-slate-900">
          <span className="font-semibold">Reason:</span> {referral.reason.text || referral.reason.label}
        </p>
      </Card>

      <div aria-live="polite">
        {generating && <Alert tone="info">Generating Q summary… This usually takes a few seconds.</Alert>}
        {failed && (
          <Alert tone="warning" title={AI_FAILED}>
            <p>The referral cannot be sent with a reviewed Q summary until the summary is available.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button onClick={() => generate(referral.referralId)} disabled={busy !== null}>
                Retry summary
              </Button>
              <ButtonLink to={profileHref} variant="secondary">
                Open patient chart
              </ButtonLink>
            </div>
          </Alert>
        )}
      </div>

      {!content && !generating && !failed && (
        <Button onClick={() => generate(referral.referralId)} disabled={busy !== null}>
          Generate Q summary
        </Button>
      )}

      {effectiveDraft && (
        <Card title="Q summary (edit before sending)">
          <SummaryEditor draft={effectiveDraft} onChange={setDraft} disabled={busy === 'send'} />
          <CheckboxField className="mt-4" label="I have reviewed this summary" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        </Card>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {effectiveDraft && (
        <Button onClick={send} disabled={!canSend} className="w-full">
          {busy === 'send' ? 'Sending…' : 'Confirm & Send referral'}
        </Button>
      )}
      <p className="text-sm text-slate-800">
        <Link to={profileHref} className="underline">
          View the patient chart
        </Link>{' '}
        to compare the summary against the recorded visits.
      </p>
    </div>
  );
}
