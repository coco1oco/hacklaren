import { AI_LABELS } from '@shared/contracts';
import { Badge, TextAreaField } from '@/components/ui';
import { draftErrors, type SummaryDraft } from './summaryDraft';

/** Review/edit form for an AI summary (checkup referrals). */
export function SummaryEditor({ draft, onChange, disabled }: { draft: SummaryDraft; onChange: (d: SummaryDraft) => void; disabled?: boolean }) {
  const errors = draftErrors(draft);
  const set = (k: keyof SummaryDraft) => (ev: { target: { value: string } }) => onChange({ ...draft, [k]: ev.target.value });
  const perLine = 'One item per line.';
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Badge tone="brand">{AI_LABELS.generated}</Badge>
        <Badge tone="warning">{AI_LABELS.reviewRequired}</Badge>
      </div>
      <p className="text-sm italic text-slate-700">{AI_LABELS.disclaimer}</p>
      <p className="text-slate-800">Check every section against the patient chart. Edit or remove anything that is not documented.</p>
      <TextAreaField label="Summary" rows={6} value={draft.summary} onChange={set('summary')} error={errors.summary} disabled={disabled} />
      <TextAreaField label="Reason for referral" rows={2} value={draft.reasonForReferral} onChange={set('reasonForReferral')} error={errors.reasonForReferral} disabled={disabled} />
      <TextAreaField label="Key findings" hint={perLine} rows={4} value={draft.keyFindings} onChange={set('keyFindings')} error={errors.keyFindings} disabled={disabled} />
      <TextAreaField
        label="Risk flags (observation requires clinical review)"
        hint={perLine}
        rows={3}
        value={draft.riskFlags}
        onChange={set('riskFlags')}
        error={errors.riskFlags}
        disabled={disabled}
      />
      <TextAreaField label="Documented trends" hint={perLine} rows={3} value={draft.abnormalTrends} onChange={set('abnormalTrends')} error={errors.abnormalTrends} disabled={disabled} />
      <TextAreaField label="Medications" hint={perLine} rows={3} value={draft.medications} onChange={set('medications')} error={errors.medications} disabled={disabled} />
    </div>
  );
}
