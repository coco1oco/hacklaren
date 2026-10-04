import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatRemaining, millis, normalizeName, normalizePhone, telHref, URINE_LABELS } from './format';
import { URINE_RESULTS } from '@shared/types';

describe('format helpers', () => {
  it('millis reads TimestampLike or returns null', () => {
    expect(millis({ toMillis: () => 42 })).toBe(42);
    expect(millis(null)).toBeNull();
    expect(millis(undefined)).toBeNull();
  });
  it('formatDateTime / formatDate fall back to a dash', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('2026-10-04')).toMatch(/2026/);
  });
  it('formatRemaining renders hours/minutes', () => {
    expect(formatRemaining(0)).toBe('expired');
    expect(formatRemaining(-5)).toBe('expired');
    expect(formatRemaining(5 * 60_000 + 30_000)).toBe('5m');
    expect(formatRemaining((12 * 60 + 42) * 60_000)).toBe('12h 42m');
  });
  it('telHref strips formatting', () => {
    expect(telHref('(044) 123-4567')).toBe('tel:0441234567');
    expect(telHref('+63 917 123 4567')).toBe('tel:+639171234567');
  });
  it('normalizeName collapses whitespace and lowercases', () => {
    expect(normalizeName('  Maria   SANTOS ')).toBe('maria santos');
  });
  it('normalizePhone converts +63 to 0', () => {
    expect(normalizePhone('+63 917-123-4567')).toBe('09171234567');
    expect(normalizePhone('0917 123 4567')).toBe('09171234567');
  });
  it('has a label for every urine result', () => {
    for (const r of URINE_RESULTS) expect(URINE_LABELS[r]).toBeTruthy();
  });
});
