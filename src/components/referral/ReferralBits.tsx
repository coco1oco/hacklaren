// Small presentational pieces shared by the referral pages and the public hospital view.
import { useState } from 'react';
import type { GenerateReferralPdfRequest } from '@shared/contracts';
import type { HospitalService, ReferralType } from '@shared/types';
import { api } from '@/lib/api';
import { downloadBase64Pdf } from '@/lib/download';
import { userMessage } from '@/lib/errors';
import { telHref } from '@/lib/format';
import { Badge, Button } from '@/components/ui';

const BIG = 'inline-flex min-h-14 items-center justify-center gap-2 rounded-lg px-5 py-3 text-center text-lg font-extrabold';

/** Large tel: link. Rendered as a link so it works without JavaScript handlers on any phone. */
export function CallLink({ phone, label, className = '' }: { phone: string; label: string; className?: string }) {
  if (!phone) return null;
  return (
    <a href={telHref(phone)} className={`${BIG} bg-green-800 text-white hover:bg-green-900 ${className}`}>
      <span aria-hidden="true">☎</span> {label}
      <span className="sr-only"> ({phone})</span>
    </a>
  );
}

export function CallHospitalPanel({ hospitalName, phone }: { hospitalName: string; phone: string }) {
  return (
    <div className="rounded-lg border-2 border-green-800 bg-green-50 p-3">
      <p className="font-bold text-green-950">Call the hospital now as well. The digital referral does not replace a phone call.</p>
      <p className="mt-1 text-slate-900">
        {hospitalName}: <span className="font-mono">{phone || 'No phone number on file'}</span>
      </p>
      <CallLink phone={phone} label="CALL HOSPITAL" className="mt-2 w-full sm:w-auto" />
    </div>
  );
}

export function TypeBadge({ type }: { type: ReferralType }) {
  return type === 'emergency' ? <Badge tone="error">EMERGENCY</Badge> : <Badge tone="info">CHECKUP</Badge>;
}

const SERVICE_TONE: Record<HospitalService, 'error' | 'info' | 'brand' | 'neutral'> = {
  CEmONC: 'brand',
  BEmONC: 'neutral',
  NICU: 'info',
  Emergency: 'error',
};

export function ServiceBadges({ services }: { services: HospitalService[] }) {
  if (!services.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {services.map((s) => (
        <Badge key={s} tone={SERVICE_TONE[s] ?? 'neutral'}>
          {s}
        </Badge>
      ))}
    </span>
  );
}

/** Calls generateReferralPdf and saves the result. The PDF is never stored at a public URL. */
export function PdfButton({
  request,
  label = 'DOWNLOAD PDF',
  errorMessage,
  className = '',
  variant = 'secondary',
}: {
  request: GenerateReferralPdfRequest;
  label?: string;
  errorMessage?: (e: unknown) => string;
  className?: string;
  variant?: 'primary' | 'secondary';
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.generateReferralPdf(request);
      downloadBase64Pdf(res.base64, res.fileName);
      setMsg('PDF downloaded.');
    } catch (e) {
      setMsg(errorMessage ? errorMessage(e) : userMessage(e, 'Unable to generate the PDF. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button variant={variant} onClick={run} disabled={busy} className="w-full">
        {busy ? 'Preparing PDF…' : label}
      </Button>
      <p aria-live="polite" className="mt-1 text-sm text-slate-800">
        {msg}
      </p>
    </div>
  );
}
