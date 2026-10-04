import type { TimestampLike } from '@shared/contracts';
import { parseIsoDate } from '@shared/pregnancy';

export function millis(ts: TimestampLike | null | undefined): number | null {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return new Date(ms).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso || parseIsoDate(iso) === null) return iso || '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

/** "12h 42m" style remaining time. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function telHref(number: string): string {
  return `tel:${number.replace(/[^0-9+]/g, '')}`;
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizePhone(n: string): string {
  const digits = n.replace(/[^0-9+]/g, '');
  return digits.startsWith('+63') ? `0${digits.slice(3)}` : digits;
}

export const URINE_LABELS: Record<string, string> = {
  not_done: 'Not done',
  negative: 'Negative',
  trace: 'Trace',
  '1+': '1+',
  '2+': '2+',
  '3+': '3+',
  '4+': '4+',
};

/**
 * Gravida/para in plain words, e.g. G3 P2 → "3 pregnancies (incl. current) · 2 births at 20+ weeks".
 * Gravida = every pregnancy however it ended (twins = 1). Para = pregnancies that reached 20+ weeks (twins = 1).
 */
export function describeGravidaPara(gravida: number | null | undefined, para: number | null | undefined): string {
  const g = gravida ?? 0;
  const p = para ?? 0;
  return `${g} ${g === 1 ? 'pregnancy' : 'pregnancies'} (incl. current) · ${p} ${p === 1 ? 'birth' : 'births'} at 20+ weeks`;
}
