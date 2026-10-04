import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ReferralLinkResult } from '@shared/contracts';
import type { StatusActor } from '@shared/types';
import { canTransition, STATUS_LABELS } from '@shared/referralStatus';
import { useAuth } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { formatDateTime, millis } from '@/lib/format';
import { Alert, Button, ButtonLink, Card, CheckboxField, Loading, PageHeader, TextAreaField } from '@/components/ui';
import { LinkPanel } from '@/components/LinkPanel';
import { LinkExpiry } from '@/components/Countdown';
import { StatusStepper } from '@/components/StatusStepper';
import { SummaryContentView, summaryLabel } from '@/components/SummaryView';
import { CallLink, PdfButton, TypeBadge } from '@/components/referral/ReferralBits';
import { SmsLogList } from '@/components/referral/SmsLogList';
import { useSmsLogs } from '@/components/referral/hooks';

const ACTOR: Record<StatusActor, string> = { midwife: 'Clinic', hospital: 'Hospital', system: 'System' };
const LINK_STATUSES = ['SENT', 'ACKNOWLEDGED'];

export default function ReferralDetailPage() {
  const { referralId } = useParams();
  const { claims } = useAuth();
  const { referrals, referralsLoading, clinicId } = useClinicData();
  const referral = referrals.find((r) => r.referralId === referralId || r.id === referralId) ?? null;
  const sms = useSmsLogs(referral?.referralId, clinicId);

  const [busy, setBusy] = useState<'cancel' | 'revoke' | 'resend' | null>(null);
  const [actionMsg, setActionMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | undefined>();
  const [smsHospital, setSmsHospital] = useState(false);
  const [newLink, setNewLink] = useState<ReferralLinkResult | null>(null);

  if (!clinicId) return <Alert tone="error" title="Clinic staff only">Your account is not assigned to a clinic.</Alert>;
  if (!referral) {
    if (referralsLoading) return <Loading label="Loading referral…" />;
    return (
      <Alert tone="error" title="Referral not found">
        It may belong to another clinic or may not have synced yet.{' '}
        <Link to="/referrals" className="underline">
          Back to referrals
        </Link>
      </Alert>
    );
  }

  const r = referral;
  const canWork = claims?.role === 'midwife' || claims?.role === 'clinic_admin';
  const canCancel = canWork && canTransition(r.type, r.status, 'CANCELLED', 'midwife').allowed;
  const linkIssued = (r.link?.issueCount ?? 0) > 0;
  const linkActiveStatus = LINK_STATUSES.includes(r.status);
  const canRevoke = canWork && linkIssued && linkActiveStatus && !r.link.revoked;
  const canResend = canWork && linkActiveStatus;
  const expiresAtMillis = millis(r.link?.expiresAt);

  const s = r.summary;
  const summaryContent = r.type === 'checkup' ? (s.state === 'approved' ? s.approvedContent : null) : s.state === 'ready' || s.state === 'approved' ? s.content : null;

  async function doCancel(e: FormEvent) {
    e.preventDefault();
    if (cancelReason.trim().length < 3) {
      setCancelError('A cancellation reason is required (at least 3 characters).');
      return;
    }
    setCancelError(undefined);
    setBusy('cancel');
    setActionMsg(null);
    try {
      await api.cancelReferral({ referralId: r.referralId, reason: cancelReason.trim() });
      setCancelOpen(false);
      setNewLink(null);
      setActionMsg({ tone: 'success', text: 'Referral cancelled. The hospital link no longer works. Please inform the hospital by phone.' });
    } catch (err) {
      setActionMsg({ tone: 'error', text: userMessage(err, 'Unable to cancel the referral. Please try again.') });
    } finally {
      setBusy(null);
    }
  }

  async function doRevoke() {
    if (!window.confirm('Revoke the hospital link? The hospital will no longer be able to open this referral until you resend a new link.')) return;
    setBusy('revoke');
    setActionMsg(null);
    try {
      await api.revokeReferralLink({ referralId: r.referralId });
      setNewLink(null);
      setActionMsg({ tone: 'success', text: 'Link revoked. Use “Resend link” to issue a new one.' });
    } catch (err) {
      setActionMsg({ tone: 'error', text: userMessage(err, 'Unable to revoke the link. Please try again.') });
    } finally {
      setBusy(null);
    }
  }

  async function doResend() {
    setBusy('resend');
    setActionMsg(null);
    try {
      const res = await api.resendReferralLink({ referralId: r.referralId, smsHospital });
      setNewLink(res.link);
      setActionMsg({ tone: 'success', text: 'New link issued. The previous link no longer works.' });
    } catch (err) {
      setActionMsg({ tone: 'error', text: userMessage(err, 'Unable to resend the link. Please try again.') });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {r.patientName} <TypeBadge type={r.type} />
          </span>
        }
        subtitle={`Referral ${r.referralId} · created ${formatDateTime(millis(r.createdAt))}`}
        actions={
          <ButtonLink to={`/patients/${r.patientId}`} variant="secondary">
            Patient profile
          </ButtonLink>
        }
      />

      <Card title="Status">
        <StatusStepper type={r.type} status={r.status} history={r.statusHistory.map((h) => h.status)} />
        {linkIssued && (
          <div className="mt-3" aria-live="polite">
            <LinkExpiry expiresAtMillis={expiresAtMillis} revoked={r.link.revoked || r.status === 'CANCELLED'} />
          </div>
        )}
        <h3 className="mt-4 font-bold text-slate-900">History</h3>
        <ol className="mt-1 grid gap-1">
          {r.statusHistory.map((h, i) => (
            <li key={i} className="border-l-4 border-slate-300 pl-3">
              <span className="font-semibold">{STATUS_LABELS[h.status]}</span> · {ACTOR[h.actor] ?? h.actor} · {formatDateTime(millis(h.at))}
              {h.note && <span className="block text-sm text-slate-800">{h.note}</span>}
            </li>
          ))}
        </ol>
        {r.type === 'checkup' && r.status === 'CREATED' && (
          <ButtonLink to={`/patients/${r.patientId}/referral/checkup?referralId=${encodeURIComponent(r.referralId)}`} className="mt-3">
            Continue review
          </ButtonLink>
        )}
      </Card>

      {r.status === 'DECLINED' && (
        <Alert tone="error" title="Declined by the hospital">
          <p>{r.declineReason || 'No reason given.'}</p>
          <ButtonLink
            to={`/patients/${r.patientId}/referral/checkup?reason=${encodeURIComponent(r.reason.text || r.reason.label)}`}
            variant="secondary"
            className="mt-2"
          >
            Select another hospital
          </ButtonLink>
        </Alert>
      )}
      {r.status === 'CANCELLED' && r.cancelReason && <Alert tone="info" title="Cancelled">{r.cancelReason}</Alert>}

      <Card title="Hospital">
        <p className="font-bold">{r.hospital.name}</p>
        <p className="text-slate-800">{r.hospital.address}</p>
        <p className="font-mono">{r.hospital.phone}</p>
        <CallLink phone={r.hospital.phone} label="CALL HOSPITAL" className="mt-2" />
      </Card>

      <Card title="Reason for referral">
        <p>
          {r.reason.label && r.reason.label !== r.reason.text && <span className="font-semibold">{r.reason.label}. </span>}
          {r.reason.text}
        </p>
        <p className="mt-1 text-sm text-slate-700">Urgency: {r.urgency === 'emergency' ? 'Emergency' : 'Routine'}</p>
      </Card>

      <Card title="AI summary">
        <div aria-live="polite">
          {summaryContent ? (
            <SummaryContentView content={summaryContent} label={summaryLabel(r.type, s.state)} />
          ) : s.state === 'failed' ? (
            <p>
              {r.type === 'emergency'
                ? "AI summary unavailable. The referral remains available. The hospital can review the patient's raw chart."
                : 'AI summary unavailable. Review the raw chart manually. Retry summary.'}
            </p>
          ) : (
            <p>{summaryLabel(r.type, s.state)}</p>
          )}
        </div>
      </Card>

      <Card title="Actions">
        {actionMsg && (
          <Alert tone={actionMsg.tone} className="mb-3">
            {actionMsg.text}
          </Alert>
        )}
        {newLink && (
          <div className="mb-3">
            <LinkPanel link={newLink} hospitalName={r.hospital.name} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <PdfButton request={{ referralId: r.referralId }} />
          <ButtonLink to={`/referrals/${r.referralId}/slip`} variant="secondary">
            Print slip
          </ButtonLink>
        </div>

        {canResend && (
          <div className="mt-4 rounded-lg border border-slate-300 p-3">
            <h3 className="font-bold">Resend link</h3>
            <p className="text-sm text-slate-800">Issues a new hospital link. The current link stops working. The referral itself is not duplicated.</p>
            <CheckboxField label="Also SMS the hospital (mobile numbers only)" checked={smsHospital} onChange={(e) => setSmsHospital(e.target.checked)} />
            <Button variant="secondary" onClick={doResend} disabled={busy !== null}>
              {busy === 'resend' ? 'Issuing new link…' : 'Resend link'}
            </Button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {canRevoke && (
            <Button variant="secondary" onClick={doRevoke} disabled={busy !== null}>
              {busy === 'revoke' ? 'Revoking…' : 'Revoke link'}
            </Button>
          )}
          {canCancel && !cancelOpen && (
            <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={busy !== null}>
              Cancel referral
            </Button>
          )}
        </div>

        {cancelOpen && (
          <form onSubmit={doCancel} noValidate className="mt-3 grid gap-2 rounded-lg border-2 border-red-700 p-3">
            <TextAreaField
              label="Cancellation reason (required)"
              value={cancelReason}
              maxLength={1000}
              onChange={(e) => setCancelReason(e.target.value)}
              error={cancelError}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy !== null}>
                {busy === 'cancel' ? 'Cancelling…' : 'Confirm cancellation'}
              </Button>
              <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy !== null}>
                Keep referral
              </Button>
            </div>
          </form>
        )}
        {!canCancel && !canResend && !canRevoke && <p className="mt-3 text-sm text-slate-700">No further changes are possible for this referral's status.</p>}
      </Card>

      <Card title="SMS messages">
        {sms.error ? <p className="text-slate-800">SMS logs are not available right now.</p> : <SmsLogList logs={sms.data} canRetry={canWork} />}
      </Card>
    </div>
  );
}
