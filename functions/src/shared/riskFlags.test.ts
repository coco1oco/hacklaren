import { describe, expect, it } from 'vitest';
import { abnormalTrends, currentMedications, REVIEW_NOTE, sortVisitsAsc, visitRiskFlags } from './riskFlags';
import type { VisitClinical } from './types';

const visit = (overrides: Partial<VisitClinical> = {}): VisitClinical => ({
  visitDate: '2026-10-04',
  bpSystolic: 120,
  bpDiastolic: 80,
  weightKg: 60,
  fhr: 140,
  glucoseMgDl: 90,
  fundalHeightCm: 30,
  urineProtein: 'negative',
  urineGlucose: 'negative',
  medications: [],
  notes: '',
  dangerSigns: { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false },
  ...overrides,
});

const codes = (v: VisitClinical) => visitRiskFlags(v).map((f) => f.code);

describe('visitRiskFlags thresholds', () => {
  it('raises nothing for an unremarkable visit', () => {
    expect(visitRiskFlags(visit())).toEqual([]);
  });
  it('flags high FHR and high glucose', () => {
    expect(codes(visit({ fhr: 170, glucoseMgDl: 180 }))).toEqual(['fhr_high', 'glucose_high']);
  });
  it('flags low glucose and low BP', () => {
    expect(codes(visit({ bpSystolic: 85, bpDiastolic: 55, glucoseMgDl: 50 }))).toEqual(['bp_low', 'glucose_low']);
  });
  it('treats thresholds as inclusive for high BP/glucose', () => {
    expect(codes(visit({ bpSystolic: 140, bpDiastolic: 80 }))).toContain('bp_high');
    expect(codes(visit({ bpSystolic: 130, bpDiastolic: 90 }))).toContain('bp_high');
    expect(codes(visit({ glucoseMgDl: 140 }))).toContain('glucose_high');
    expect(codes(visit({ fhr: 160 }))).not.toContain('fhr_high');
    expect(codes(visit({ fhr: 110 }))).not.toContain('fhr_low');
  });
  it('ignores missing optional values', () => {
    expect(codes(visit({ fhr: null, glucoseMgDl: undefined }))).toEqual([]);
  });
  it('flags trace urine protein only from 1+', () => {
    expect(codes(visit({ urineProtein: 'trace' }))).toEqual([]);
    expect(codes(visit({ urineProtein: '1+' }))).toEqual(['urine_protein']);
  });
  it('carries the visit date and review wording', () => {
    const [flag] = visitRiskFlags(visit({ visitDate: '2026-09-01', glucoseMgDl: 200 }));
    expect(flag.visitDate).toBe('2026-09-01');
    expect(flag.detail).toContain(REVIEW_NOTE);
    expect(flag.detail).not.toMatch(/diagnos|diabetes/i);
  });
});

describe('abnormalTrends', () => {
  it('describes rapid weight gain between visits', () => {
    const trends = abnormalTrends([visit({ visitDate: '2026-09-15', weightKg: 63 }), visit({ visitDate: '2026-09-01', weightKg: 60 })]);
    expect(trends).toContain('Weight changed by 3.0 kg between 2026-09-01 and 2026-09-15.');
  });
  it('does not flag gradual weight gain', () => {
    expect(abnormalTrends([visit({ visitDate: '2026-08-01', weightKg: 60 }), visit({ visitDate: '2026-09-01', weightKg: 62 })])).toEqual([]);
  });
  it('describes rising diastolic BP and repeated elevated BP', () => {
    const trends = abnormalTrends([
      visit({ visitDate: '2026-08-01', bpSystolic: 145, bpDiastolic: 85 }),
      visit({ visitDate: '2026-09-01', bpSystolic: 145, bpDiastolic: 92 }),
      visit({ visitDate: '2026-10-01', bpSystolic: 145, bpDiastolic: 96 }),
    ]);
    expect(trends.some((t) => t.startsWith('Diastolic BP increased'))).toBe(true);
    expect(trends.some((t) => t.startsWith('Systolic BP increased'))).toBe(false);
    expect(trends).toContain('BP at or above the configured review threshold at 3 visits.');
  });
  it('returns nothing for fewer than 2 visits', () => {
    expect(abnormalTrends([visit()])).toEqual([]);
    expect(abnormalTrends([])).toEqual([]);
  });
});

describe('sortVisitsAsc / currentMedications', () => {
  const visits = [
    visit({ visitDate: '2026-10-01', medications: ['Ferrous sulfate', 'Calcium carbonate'] }),
    visit({ visitDate: '2026-08-01', medications: ['Folic acid'] }),
    visit({ visitDate: '2026-09-01', medications: ['Ferrous sulfate'] }),
  ];
  it('sorts without mutating the input', () => {
    const copy = [...visits];
    expect(sortVisitsAsc(visits).map((v) => v.visitDate)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(visits).toEqual(copy);
  });
  it('returns medications from the most recent visit', () => {
    expect(currentMedications(visits)).toEqual(['Ferrous sulfate', 'Calcium carbonate']);
  });
  it('returns an empty list with no visits', () => {
    expect(currentMedications([])).toEqual([]);
  });
});
