// Deterministic Asia/Manila (UTC+8, no DST) date helpers. Cloud Functions run in UTC, so never use local-time getters.
import { parseIsoDate } from '../shared/pregnancy';

const MANILA_OFFSET_MS = 8 * 3_600_000;

export function manilaDateIso(millis: number): string {
  return new Date(millis + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** e.g. "2025-03-04 14:05 PHT" */
export function manilaDateTime(millis: number): string {
  const iso = new Date(millis + MANILA_OFFSET_MS).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} PHT`;
}

/** Age in completed years on a given ISO date. Null for malformed input. */
export function ageOnDate(birthdate: string, onIso: string): number | null {
  if (parseIsoDate(birthdate) === null || parseIsoDate(onIso) === null) return null;
  const [by, bm, bd] = birthdate.split('-').map(Number);
  const [y, m, d] = onIso.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 ? age : null;
}
