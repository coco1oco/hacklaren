import type { SummaryContext, SummaryProvider } from '../../shared/contracts';
import type { QSummaryContent, VisitClinical } from '../../shared/types';
import { DANGER_SIGN_LABELS } from '../../shared/types';
import { abnormalTrends, currentMedications, sortVisitsAsc, visitRiskFlags } from '../../shared/riskFlags';

export const MOCK_FAIL_MARKER = '[[mock-fail]]';
export const NOT_DOCUMENTED = 'Not documented';
const REVIEW = 'Observation requires clinical review.';

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);
const list = (items: string[]) => (items.length ? items.join(', ') : NOT_DOCUMENTED);
const num = (v: number | null | undefined, unit: string) => (v == null ? NOT_DOCUMENTED : `${v} ${unit}`);

function urine(v: VisitClinical['urineProtein']): string {
  return v === 'not_done' ? NOT_DOCUMENTED : v;
}

function describeVisit(v: VisitClinical): string {
  const signs = (Object.keys(DANGER_SIGN_LABELS) as (keyof typeof DANGER_SIGN_LABELS)[]).filter((k) => v.dangerSigns?.[k]).map((k) => DANGER_SIGN_LABELS[k]);
  return [
    `BP ${v.bpSystolic}/${v.bpDiastolic} mmHg`,
    `weight ${num(v.weightKg, 'kg')}`,
    `FHR ${num(v.fhr, 'bpm')}`,
    `glucose ${num(v.glucoseMgDl, 'mg/dL')}`,
    `fundal height ${num(v.fundalHeightCm, 'cm')}`,
    `urine protein ${urine(v.urineProtein)}`,
    `danger signs ${signs.length ? signs.join(', ') : 'none documented'}`,
  ].join('; ');
}

/**
 * Deterministic development provider. Uses only SummaryContext values; describes documented data
 * neutrally and never states a diagnosis.
 */
export class MockSummaryProvider implements SummaryProvider {
  readonly name = 'mock';

  async generate(context: SummaryContext): Promise<QSummaryContent> {
    if (context.reasonForReferral.includes(MOCK_FAIL_MARKER)) {
      throw new Error('Mock summary provider failure (test hook).');
    }
    const visits = sortVisitsAsc(context.visits);
    const latest = visits[visits.length - 1];
    const flags = visits.flatMap(visitRiskFlags);
    const trends = abnormalTrends(visits);
    const meds = currentMedications(visits);

    const summaryParts = [
      `${context.referralType === 'emergency' ? 'Emergency' : 'Checkup'} referral.`,
      `Age: ${context.ageYears == null ? NOT_DOCUMENTED : `${context.ageYears} years`}.`,
      `G${context.gravida}P${context.para}, gestational age ${context.gestationalAge} (${context.trimester}).`,
      `Blood type: ${context.bloodType || NOT_DOCUMENTED}. Allergies: ${list(context.allergies)}.`,
      `${visits.length} prenatal visit${visits.length === 1 ? '' : 's'} documented.`,
      latest ? `Most recent visit ${latest.visitDate}: ${describeVisit(latest)}.` : 'No prenatal visits documented.',
      flags.length ? `${flags.length} recorded value${flags.length === 1 ? '' : 's'} exceed configured review thresholds. ${REVIEW}` : 'No recorded values exceed configured review thresholds.',
    ];

    const keyFindings: string[] = [];
    if (latest) {
      keyFindings.push(`Latest BP ${latest.bpSystolic}/${latest.bpDiastolic} mmHg (${latest.visitDate}).`);
      keyFindings.push(`Latest weight ${num(latest.weightKg, 'kg')}.`);
      keyFindings.push(`Latest FHR ${num(latest.fhr, 'bpm')}.`);
      keyFindings.push(`Latest glucose ${num(latest.glucoseMgDl, 'mg/dL')}.`);
      keyFindings.push(`Latest urine protein ${urine(latest.urineProtein)}.`);
    } else {
      keyFindings.push(`Prenatal visits: ${NOT_DOCUMENTED}.`);
    }
    keyFindings.push(`Medical history: ${list(context.medicalHistory)}.`);
    keyFindings.push(`Obstetric history: ${list(context.obstetricHistory)}.`);

    const riskFlags = Array.from(new Set(flags.map((f) => `${f.visitDate}: ${f.label}. ${f.detail}`)));

    return {
      summary: clip(summaryParts.join(' '), 3000),
      keyFindings: keyFindings.slice(0, 30).map((s) => clip(s, 500)),
      riskFlags: riskFlags.slice(-30).map((s) => clip(s, 500)),
      medications: meds.slice(0, 50).map((s) => clip(s, 200)).filter((s) => s.trim().length > 0),
      reasonForReferral: clip(context.reasonForReferral.trim() || NOT_DOCUMENTED, 1000),
      abnormalTrends: trends.slice(0, 30).map((s) => clip(s, 500)),
    };
  }
}
