import { useState } from 'react';
import type { SmsLogDoc, SmsMessageType, SmsRecipientRole, SmsStatus } from '@shared/contracts';
import type { WithMeta } from '@/lib/firestore';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { formatDateTime, millis } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

const STATUS: Record<SmsStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'error' }> = {
  queued: { label: 'SMS queued', tone: 'neutral' },
  sent: { label: 'SMS sent', tone: 'info' },
  delivered: { label: 'SMS delivered', tone: 'success' },
  failed: { label: 'SMS failed', tone: 'error' },
};

const ROLE: Record<SmsRecipientRole, string> = {
  patient: 'Patient',
  midwife: 'Midwife',
  bhw: 'Barangay Health Worker',
  mho: 'Municipal Health Office',
  hospital: 'Hospital',
};

const TYPE: Record<SmsMessageType, string> = {
  patient_referral_created: 'Referral notice to patient',
  emergency_alert_bhw: 'Emergency alert',
  emergency_alert_mho: 'Emergency alert',
  hospital_referral_link: 'Hospital link',
  midwife_referral_link: 'Hospital link copy',
  midwife_status_acknowledged: 'Acknowledged notice',
  midwife_status_declined: 'Declined notice',
};

const LINK_TYPES: SmsMessageType[] = ['hospital_referral_link', 'midwife_referral_link'];

export function SmsLogList({ logs, canRetry }: { logs: WithMeta<SmsLogDoc>[]; canRetry: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const sorted = [...logs].sort((a, b) => (millis(b.createdAt) ?? 0) - (millis(a.createdAt) ?? 0));

  async function retry(id: string) {
    setBusy(id);
    setMsg(null);
    try {
      const res = await api.resendSms({ smsLogId: id });
      setMsg(res.status === 'failed' ? 'The SMS failed again. Call the recipient instead.' : 'SMS resent.');
    } catch (e) {
      setMsg(userMessage(e, 'Unable to resend the SMS. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  if (!sorted.length) return <p className="text-slate-800">No SMS messages recorded for this referral.</p>;

  return (
    <div>
      <ul className="grid gap-2">
        {sorted.map((l) => {
          const s = STATUS[l.status] ?? STATUS.queued;
          const isLink = LINK_TYPES.includes(l.messageType);
          return (
            <li key={l.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={s.tone}>{s.label}</Badge>
                <span className="font-semibold">{TYPE[l.messageType] ?? l.messageType}</span>
              </div>
              <p className="mt-1 text-sm text-slate-800">
                To {ROLE[l.recipientRole] ?? l.recipientRole} · <span className="font-mono">{l.recipientMasked}</span> · {formatDateTime(millis(l.createdAt))}
                {l.retryCount > 0 && ` · retried ${l.retryCount}×`}
              </p>
              {l.status === 'failed' && canRetry && !isLink && (
                <Button variant="secondary" className="mt-2" disabled={busy !== null} onClick={() => retry(l.id)}>
                  {busy === l.id ? 'Retrying…' : 'Retry SMS'}
                </Button>
              )}
              {l.status === 'failed' && isLink && (
                <p className="mt-1 text-sm text-slate-800">Link messages cannot be resent as-is. Use “Resend link” to issue a new hospital link.</p>
              )}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="mt-2 text-slate-900">
        {msg}
      </p>
    </div>
  );
}
