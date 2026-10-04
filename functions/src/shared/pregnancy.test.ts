import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  checkPregnancyDates,
  eddFromLmp,
  formatGestationalAge,
  gestationalAge,
  isDueSoon,
  parseIsoDate,
  trimester,
} from './pregnancy';

describe('parseIsoDate', () => {
  it('rejects malformed and impossible dates', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026/02/01')).toBeNull();
    expect(parseIsoDate('')).toBeNull();
    expect(parseIsoDate('2026-02-28')).not.toBeNull();
  });
});

describe('gestationalAge', () => {
  it('computes weeks and days from LMP', () => {
    expect(gestationalAge('2026-03-10', '2026-10-06')).toEqual({ totalDays: 210, weeks: 30, days: 0 });
    expect(gestationalAge('2026-03-10', '2026-10-09')).toEqual({ totalDays: 213, weeks: 30, days: 3 });
  });
  it('returns null for future LMP or invalid input', () => {
    expect(gestationalAge('2026-12-01', '2026-10-01')).toBeNull();
    expect(gestationalAge('bad', '2026-10-01')).toBeNull();
  });
  it('formats', () => {
    expect(formatGestationalAge({ totalDays: 210, weeks: 30, days: 0 })).toBe('30 weeks');
    expect(formatGestationalAge(null)).toBe('Not available');
  });
});

describe('trimester', () => {
  const ga = (weeks: number) => ({ totalDays: weeks * 7, weeks, days: 0 });
  it('uses 14 and 28 week boundaries', () => {
    expect(trimester(ga(0))).toBe(1);
    expect(trimester(ga(13))).toBe(1);
    expect(trimester(ga(14))).toBe(2);
    expect(trimester(ga(27))).toBe(2);
    expect(trimester(ga(28))).toBe(3);
    expect(trimester(ga(41))).toBe(3);
    expect(trimester(null)).toBeNull();
  });
});

describe('EDD', () => {
  it('applies Naegele (+280 days)', () => {
    expect(eddFromLmp('2026-03-10')).toBe('2026-12-15');
  });
  it('warns on inconsistent dates without hard failure', () => {
    const now = new Date(2026, 9, 4);
    expect(checkPregnancyDates('2026-03-10', '2026-12-15', now).ok).toBe(true);
    const bad = checkPregnancyDates('2026-03-10', '2027-02-01', now);
    expect(bad.ok).toBe(false);
    expect(bad.warnings[0]).toMatch(/differs/);
    expect(checkPregnancyDates('2026-11-10', '2027-08-17', now).warnings).toContain('LMP is in the future.');
  });
});

describe('isDueSoon', () => {
  const now = new Date(2026, 9, 4);
  it('is true within 4 weeks of EDD', () => {
    expect(isDueSoon('2026-10-20', now)).toBe(true);
    expect(isDueSoon('2026-11-01', now)).toBe(true);
    expect(isDueSoon('2026-11-02', now)).toBe(false);
    expect(isDueSoon('2026-10-01', now)).toBe(false);
  });
});

describe('ageInYears', () => {
  it('accounts for birthday not yet reached', () => {
    expect(ageInYears('1999-05-12', new Date(2026, 9, 4))).toBe(27);
    expect(ageInYears('1999-12-12', new Date(2026, 9, 4))).toBe(26);
  });
});
