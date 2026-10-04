import { useState } from 'react';
import type { ReferralLinkResult } from '@shared/contracts';
import { Button } from './ui';
import { LinkExpiry } from './Countdown';

/** Shows a freshly issued hospital link. The raw token is never stored, so it cannot be shown again. */
export function LinkPanel({ link, hospitalName }: { link: ReferralLinkResult; hospitalName: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied('Link copied.');
    } catch {
      setCopied('Could not copy automatically. Press and hold the link to copy it.');
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'MARA referral', text: `Referral for ${hospitalName}`, url: link.url });
    } catch {
      // user cancelled
    }
  }

  return (
    <div className="rounded-lg border-2 border-brand-800 bg-brand-50 p-3">
      <p className="font-bold text-brand-900">Hospital link</p>
      <p className="mt-1 break-all rounded bg-white p-2 font-mono text-sm" data-testid="referral-link">
        {link.url}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          Copy link
        </Button>
        {canShare && (
          <Button variant="secondary" onClick={share}>
            Share
          </Button>
        )}
      </div>
      <p aria-live="polite" className="mt-1 text-sm text-slate-800">
        {copied}
      </p>
      <div className="mt-2">
        <LinkExpiry expiresAtMillis={link.expiresAtMillis} />
      </div>
      <p className="mt-2 text-sm text-slate-800">
        This link is shown only once and cannot be displayed again. If it is lost, use <strong>Resend link</strong> on the referral page. That issues a new
        link and the old one stops working.
      </p>
    </div>
  );
}
