// Gestational age is always derived from LMP + today's date. It is never stored as the source of truth.

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a YYYY-MM-DD string to a UTC day number. Returns null for malformed or impossible dates. */
export function parseIsoDate(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return Math.floor(t / MS_PER_DAY);
}

/** Today's calendar date in the user's local time zone, as a UTC day number. */
export function localDayNumber(now: Date = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY);
}

export function dayNumberToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return dayNumberToIso(localDayNumber(now));
}

export interface GestationalAge {
  totalDays: number;
  weeks: number;
  days: number;
}

/** Gestational age on `on` (default: today) based on LMP. Null if LMP is invalid or in the future. */
export function gestationalAge(lmp: string, on: Date | string = new Date()): GestationalAge | null {
  const lmpDay = parseIsoDate(lmp);
  const onDay = typeof on === 'string' ? parseIsoDate(on) : localDayNumber(on);
  if (lmpDay === null || onDay === null) return null;
  const totalDays = onDay - lmpDay;
  if (totalDays < 0) return null;
  return { totalDays, weeks: Math.floor(totalDays / 7), days: totalDays % 7 };
}

export type Trimester = 1 | 2 | 3;

/** 1st: 0–13w6d, 2nd: 14w0d–27w6d, 3rd: 28w0d onward. */
export function trimester(ga: GestationalAge | null): Trimester | null {
  if (!ga) return null;
  if (ga.weeks < 14) return 1;
  if (ga.weeks < 28) return 2;
  return 3;
}

export function trimesterLabel(t: Trimester | null): string {
  if (t === 1) return '1st trimester';
  if (t === 2) return '2nd trimester';
  if (t === 3) return '3rd trimester';
  return 'Unknown';
}

export function formatGestationalAge(ga: GestationalAge | null): string {
  if (!ga) return 'Not available';
  return ga.days === 0 ? `${ga.weeks} weeks` : `${ga.weeks} weeks ${ga.days} days`;
}

/** Naegele's rule: EDD = LMP + 280 days. */
export function eddFromLmp(lmp: string): string | null {
  const lmpDay = parseIsoDate(lmp);
  return lmpDay === null ? null : dayNumberToIso(lmpDay + 280);
}

export interface PregnancyDateCheck {
  ok: boolean;
  warnings: string[];
}

/**
 * Consistency check between LMP and EDD. Returns warnings (not hard errors) so the midwife can
 * confirm dates that legitimately differ, e.g. an ultrasound-adjusted EDD.
 */
export function checkPregnancyDates(lmp: string, edd: string, now: Date = new Date()): PregnancyDateCheck {
  const warnings: string[] = [];
  const lmpDay = parseIsoDate(lmp);
  const eddDay = parseIsoDate(edd);
  const today = localDayNumber(now);
  if (lmpDay === null) warnings.push('LMP is not a valid date.');
  if (eddDay === null) warnings.push('EDD is not a valid date.');
  if (lmpDay !== null && lmpDay > today) warnings.push('LMP is in the future.');
  if (lmpDay !== null && today - lmpDay > 45 * 7) warnings.push('LMP is more than 45 weeks ago. Please verify.');
  if (lmpDay !== null && eddDay !== null) {
    const diff = eddDay - (lmpDay + 280);
    if (Math.abs(diff) > 14) {
      warnings.push(`EDD differs from LMP-based EDD (${dayNumberToIso(lmpDay + 280)}) by ${Math.abs(diff)} days. Please verify.`);
    }
  }
  return { ok: warnings.length === 0, warnings };
}

/** Days from today until EDD (negative when past EDD). */
export function daysUntil(dateIso: string, now: Date = new Date()): number | null {
  const d = parseIsoDate(dateIso);
  return d === null ? null : d - localDayNumber(now);
}

/** Informational dashboard metric: EDD within the next `withinDays` days (default 28 = 4 weeks). */
export function isDueSoon(edd: string, now: Date = new Date(), withinDays = 28): boolean {
  const n = daysUntil(edd, now);
  return n !== null && n >= 0 && n <= withinDays;
}

export function ageInYears(birthdate: string, now: Date = new Date()): number | null {
  if (parseIsoDate(birthdate) === null) return null;
  const [y, m, d] = birthdate.split('-').map(Number);
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}
