import { formatGestationalAge, gestationalAge, trimester, trimesterLabel, type GestationalAge, type Trimester } from '@shared/pregnancy';

export interface PregnancyStatus {
  ga: GestationalAge | null;
  gaLabel: string;
  trimester: Trimester | null;
  trimesterLabel: string;
}

/** Gestational age + trimester derived from LMP and today's date (never stored). */
export function pregnancyStatus(lmp: string | null | undefined, now: Date = new Date()): PregnancyStatus {
  const ga = lmp ? gestationalAge(lmp, now) : null;
  const t = trimester(ga);
  return { ga, gaLabel: formatGestationalAge(ga), trimester: t, trimesterLabel: trimesterLabel(t) };
}

/** Number input helpers for React Hook Form: empty → null (optional) or NaN (required, so zod reports it). */
export const optionalNumber = (v: unknown): number | null => (v === '' || v === null || v === undefined ? null : Number(v));
export const requiredNumber = (v: unknown): number => (v === '' || v === null || v === undefined ? Number.NaN : Number(v));
