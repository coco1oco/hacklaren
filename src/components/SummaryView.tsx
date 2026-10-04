import type { QSummaryContent, ReferralType, SummaryState } from '@shared/types';
import { AI_LABELS } from '@shared/contracts';
import { Badge } from './ui';

/** Label shown with a summary for clinic staff (hospital view gets its label from the server). */
export function summaryLabel(type: ReferralType, state: SummaryState): string {
  if (state === 'approved') return AI_LABELS.reviewed;
  if (state === 'ready') return type === 'emergency' ? AI_LABELS.notReviewed : AI_LABELS.reviewRequired;
  if (state === 'pending' || state === 'generating') return 'Q summary is being generated in the background';
  if (state === 'failed') return 'Q summary unavailable. Review the raw chart manually.';
  return 'No Q summary';
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <h3 className="font-bold text-slate-900">{title}</h3>
      <ul className="ml-5 list-disc">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

export function SummaryContentView({ content, label }: { content: QSummaryContent; label: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {label.split(' · ').map((l) => (
          <Badge key={l} tone="brand">
            {l}
          </Badge>
        ))}
      </div>
      <p className="mt-2 text-sm italic text-slate-700">{AI_LABELS.disclaimer}</p>
      <p className="mt-3 whitespace-pre-line">{content.summary}</p>
      <div className="mt-3">
        <h3 className="font-bold text-slate-900">Reason for referral</h3>
        <p>{content.reasonForReferral}</p>
      </div>
      <List title="Key findings" items={content.keyFindings} />
      <List title="Risk flags (observation requires clinical review)" items={content.riskFlags} />
      <List title="Documented trends" items={content.abnormalTrends} />
      <List title="Medications" items={content.medications} />
    </div>
  );
}
