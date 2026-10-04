import { describe, expect, it } from 'vitest';
import { daysUntil, dayNumberToIso, parseIsoDate, todayIso, trimesterLabel } from './pregnancy';

describe('trimesterLabel', () => {
  it('labels each trimester and unknown', () => {
    expect(trimesterLabel(1)).toBe('1st trimester');
    expect(trimesterLabel(2)).toBe('2nd trimester');
    expect(trimesterLabel(3)).toBe('3rd trimester');
    expect(trimesterLabel(null)).toBe('Unknown');
  });
});

describe('daysUntil', () => {
  const now = new Date(2026, 9, 4); // 2026-10-04 local
  it('counts calendar days to a future date', () => {
    expect(daysUntil('2026-10-04', now)).toBe(0);
    expect(daysUntil('2026-10-05', now)).toBe(1);
    expect(daysUntil('2026-12-15', now)).toBe(72);
  });
  it('is negative for past dates', () => {
    expect(daysUntil('2026-10-01', now)).toBe(-3);
  });
  it('returns null for invalid dates', () => {
    expect(daysUntil('2026-02-30', now)).toBeNull();
    expect(daysUntil('', now)).toBeNull();
  });
  it('ignores time of day', () => {
    expect(daysUntil('2026-10-05', new Date(2026, 9, 4, 23, 59))).toBe(1);
  });
});

describe('date helpers', () => {
  it('round-trips ISO dates', () => {
    const d = parseIsoDate('2026-03-10');
    expect(d).not.toBeNull();
    expect(dayNumberToIso(d as number)).toBe('2026-03-10');
  });
  it('todayIso uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});
