import type { QSummaryContent } from '@shared/types';

/** Editable form of a summary. List fields are edited as one item per line. */
export interface SummaryDraft {
  summary: string;
  keyFindings: string;
  riskFlags: string;
  medications: string;
  reasonForReferral: string;
  abnormalTrends: string;
}

export function toDraft(c: QSummaryContent): SummaryDraft {
  return {
    summary: c.summary,
    keyFindings: c.keyFindings.join('\n'),
    riskFlags: c.riskFlags.join('\n'),
    medications: c.medications.join('\n'),
    reasonForReferral: c.reasonForReferral,
    abnormalTrends: c.abnormalTrends.join('\n'),
  };
}

const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

export function fromDraft(d: SummaryDraft): QSummaryContent {
  return {
    summary: d.summary.trim(),
    keyFindings: lines(d.keyFindings),
    riskFlags: lines(d.riskFlags),
    medications: lines(d.medications),
    reasonForReferral: d.reasonForReferral.trim(),
    abnormalTrends: lines(d.abnormalTrends),
  };
}

export type DraftErrors = Partial<Record<keyof SummaryDraft, string>>;

/** Mirrors qSummaryContentSchema limits so the server never rejects a reviewed summary. */
export function draftErrors(d: SummaryDraft): DraftErrors {
  const c = fromDraft(d);
  const e: DraftErrors = {};
  if (!c.summary) e.summary = 'The summary cannot be empty.';
  else if (c.summary.length > 3000) e.summary = 'Keep the summary under 3000 characters.';
  if (!c.reasonForReferral) e.reasonForReferral = 'The reason for referral cannot be empty.';
  else if (c.reasonForReferral.length > 1000) e.reasonForReferral = 'Keep the reason under 1000 characters.';
  const listCheck = (key: keyof SummaryDraft, items: string[], maxItems: number, maxLen: number) => {
    if (items.length > maxItems) e[key] = `Use at most ${maxItems} lines.`;
    else if (items.some((x) => x.length > maxLen)) e[key] = `Each line must be under ${maxLen} characters.`;
  };
  listCheck('keyFindings', c.keyFindings, 30, 500);
  listCheck('riskFlags', c.riskFlags, 30, 500);
  listCheck('abnormalTrends', c.abnormalTrends, 30, 500);
  listCheck('medications', c.medications, 50, 200);
  return e;
}
