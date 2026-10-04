import type { DangerSigns, VisitClinical } from './types';
import { DANGER_SIGN_LABELS } from './types';

/**
 * Configured review thresholds. These highlight recorded values for clinical review.
 * They are NOT diagnostic criteria and MARA never states a diagnosis.
 */
export const REVIEW_THRESHOLDS = {
  bpSystolicHigh: 140,
  bpDiastolicHigh: 90,
  bpSystolicLow: 90,
  bpDiastolicLow: 60,
  fhrLow: 110,
  fhrHigh: 160,
  glucoseHigh: 140, // mg/dL, random/non-fasting
  glucoseLow: 60,
} as const;

/** Values outside these ranges are probably entry mistakes. The UI warns but still allows saving. */
export const INPUT_EXPECTED_RANGES = {
  bpSystolic: [70, 220],
  bpDiastolic: [40, 140],
  weightKg: [35, 150],
  fhr: [80, 200],
  glucoseMgDl: [40, 400],
  fundalHeightCm: [10, 45],
} as const;

/** Physically impossible values. These block saving. */
export const INPUT_HARD_LIMITS = {
  bpSystolic: [30, 300],
  bpDiastolic: [10, 200],
  weightKg: [20, 300],
  fhr: [30, 260],
  glucoseMgDl: [10, 1000],
  fundalHeightCm: [1, 60],
} as const;

export type RangedField = keyof typeof INPUT_EXPECTED_RANGES;

export const RANGE_WARNING = 'This value is outside the expected input range. Please verify the measurement.';

export function outsideExpectedRange(field: RangedField, value: number | null | undefined): boolean {
  if (value === null || value === undefined || Number.isNaN(value)) return false;
  const [min, max] = INPUT_EXPECTED_RANGES[field];
  return value < min || value > max;
}

export type RiskFlagCode = 'bp_high' | 'bp_low' | 'fhr_low' | 'fhr_high' | 'glucose_high' | 'glucose_low' | 'urine_protein' | 'danger_sign';

export interface RiskFlag {
  code: RiskFlagCode;
  label: string;
  detail: string;
  visitDate: string;
}

export const REVIEW_NOTE = 'Recorded value exceeds configured review threshold. Observation requires clinical review.';

export function visitRiskFlags(v: VisitClinical): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const t = REVIEW_THRESHOLDS;
  if (v.bpSystolic >= t.bpSystolicHigh || v.bpDiastolic >= t.bpDiastolicHigh) {
    flags.push({ code: 'bp_high', label: 'Elevated BP', detail: `BP ${v.bpSystolic}/${v.bpDiastolic} mmHg (review threshold ${t.bpSystolicHigh}/${t.bpDiastolicHigh}). ${REVIEW_NOTE}`, visitDate: v.visitDate });
  } else if (v.bpSystolic < t.bpSystolicLow || v.bpDiastolic < t.bpDiastolicLow) {
    flags.push({ code: 'bp_low', label: 'Low BP', detail: `BP ${v.bpSystolic}/${v.bpDiastolic} mmHg. ${REVIEW_NOTE}`, visitDate: v.visitDate });
  }
  if (v.fhr != null) {
    if (v.fhr < t.fhrLow) flags.push({ code: 'fhr_low', label: 'Low FHR', detail: `FHR ${v.fhr} bpm. ${REVIEW_NOTE}`, visitDate: v.visitDate });
    else if (v.fhr > t.fhrHigh) flags.push({ code: 'fhr_high', label: 'High FHR', detail: `FHR ${v.fhr} bpm. ${REVIEW_NOTE}`, visitDate: v.visitDate });
  }
  if (v.glucoseMgDl != null) {
    if (v.glucoseMgDl >= t.glucoseHigh) flags.push({ code: 'glucose_high', label: 'High glucose', detail: `Glucose ${v.glucoseMgDl} mg/dL. ${REVIEW_NOTE}`, visitDate: v.visitDate });
    else if (v.glucoseMgDl < t.glucoseLow) flags.push({ code: 'glucose_low', label: 'Low glucose', detail: `Glucose ${v.glucoseMgDl} mg/dL. ${REVIEW_NOTE}`, visitDate: v.visitDate });
  }
  if (['1+', '2+', '3+', '4+'].includes(v.urineProtein)) {
    flags.push({ code: 'urine_protein', label: 'Urine protein recorded', detail: `Urine protein ${v.urineProtein}. Observation requires clinical review.`, visitDate: v.visitDate });
  }
  const signs = (Object.keys(DANGER_SIGN_LABELS) as (keyof DangerSigns)[]).filter((k) => v.dangerSigns?.[k]);
  if (signs.length) {
    flags.push({ code: 'danger_sign', label: 'Danger sign recorded', detail: `${signs.map((k) => DANGER_SIGN_LABELS[k]).join(', ')} documented. Observation requires clinical review.`, visitDate: v.visitDate });
  }
  return flags;
}

/** Returns a copy sorted oldest → newest by visitDate. */
export function sortVisitsAsc<T extends { visitDate: string }>(visits: T[]): T[] {
  return [...visits].sort((a, b) => a.visitDate.localeCompare(b.visitDate));
}

/** Describes documented trends neutrally. Never interprets a trend clinically. */
export function abnormalTrends(visits: VisitClinical[]): string[] {
  const asc = sortVisitsAsc(visits);
  const out: string[] = [];
  const last = asc.slice(-3);
  if (last.length === 3) {
    const sys = last.map((v) => v.bpSystolic);
    const dia = last.map((v) => v.bpDiastolic);
    if (sys[0] < sys[1] && sys[1] < sys[2]) out.push(`Systolic BP increased across the last 3 visits (${sys.join(' → ')} mmHg).`);
    if (dia[0] < dia[1] && dia[1] < dia[2]) out.push(`Diastolic BP increased across the last 3 visits (${dia.join(' → ')} mmHg).`);
  }
  for (let i = 1; i < asc.length; i++) {
    const prev = asc[i - 1];
    const cur = asc[i];
    const days = Math.max(1, (Date.parse(cur.visitDate) - Date.parse(prev.visitDate)) / 86_400_000);
    const perWeek = ((cur.weightKg - prev.weightKg) / days) * 7;
    if (perWeek > 1) out.push(`Weight changed by ${(cur.weightKg - prev.weightKg).toFixed(1)} kg between ${prev.visitDate} and ${cur.visitDate}.`);
  }
  const flaggedBp = asc.filter((v) => v.bpSystolic >= REVIEW_THRESHOLDS.bpSystolicHigh || v.bpDiastolic >= REVIEW_THRESHOLDS.bpDiastolicHigh);
  if (flaggedBp.length >= 2) out.push(`BP at or above the configured review threshold at ${flaggedBp.length} visits.`);
  return out;
}

/** Medications recorded at the most recent visit. */
export function currentMedications(visits: VisitClinical[]): string[] {
  const asc = sortVisitsAsc(visits);
  return asc.length ? asc[asc.length - 1].medications : [];
}
