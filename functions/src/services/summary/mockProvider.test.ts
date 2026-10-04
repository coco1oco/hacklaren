import { describe, expect, it } from 'vitest';
import { MockSummaryProvider } from './mockProvider';
import { qSummaryContentSchema } from '../../shared/schemas';
import type { SummaryContext, SummaryProvider } from '../../shared/contracts';
import type { VisitClinical } from '../../shared/types';

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

const context = (overrides: Partial<SummaryContext> = {}): SummaryContext => ({
  referralType: 'checkup',
  reasonForReferral: 'Rising BP across the last three visits',
  ageYears: 31,
  gestationalAge: '30 weeks 2 days',
  trimester: '3rd trimester',
  gravida: 2,
  para: 1,
  bloodType: 'O+',
  allergies: ['Penicillin'],
  medicalHistory: ['Asthma'],
  obstetricHistory: ['G1: SVD 2023'],
  visits: [
    visit({ visitDate: '2026-08-01', bpSystolic: 128, bpDiastolic: 82, weightKg: 58, medications: ['Folic acid'] }),
    visit({ visitDate: '2026-09-01', bpSystolic: 142, bpDiastolic: 92, weightKg: 60, medications: ['Ferrous sulfate'] }),
    visit({
      visitDate: '2026-10-01',
      bpSystolic: 156,
      bpDiastolic: 101,
      weightKg: 62,
      fhr: null,
      glucoseMgDl: null,
      fundalHeightCm: null,
      urineProtein: '2+',
      medications: ['Ferrous sulfate', 'Calcium carbonate'],
      dangerSigns: { bleeding: false, severeHeadache: true, blurredVision: false, reducedFetalMovement: false },
    }),
  ],
  ...overrides,
});

const DIAGNOSTIC_WORDS = [
  /pre-?eclampsia/i,
  /\beclampsia/i,
  /diagnos/i, // diagnosis, diagnosed, diagnose
  /recommend/i,
  /hypertensi/i,
  /gestational diabetes/i,
  /\bprescri/i,
  /treatment plan/i,
];

const allText = (o: unknown) => JSON.stringify(o);

describe('MockSummaryProvider', () => {
  const provider: SummaryProvider = new MockSummaryProvider();

  it('is named "mock"', () => {
    expect(provider.name).toBe('mock');
  });

  it('returns output that passes qSummaryContentSchema', async () => {
    const out = await provider.generate(context());
    const parsed = qSummaryContentSchema.safeParse(out);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('preserves the reason for referral', async () => {
    const out = await provider.generate(context());
    expect(out.reasonForReferral).toContain('Rising BP across the last three visits');
  });

  it('never uses diagnostic language', async () => {
    for (const type of ['checkup', 'emergency'] as const) {
      const text = allText(await provider.generate(context({ referralType: type })));
      for (const re of DIAGNOSTIC_WORDS) expect(text, `matched ${re}`).not.toMatch(re);
    }
  });

  it('only cites documented BP values', async () => {
    const ctx = context();
    // The configured review threshold (e.g. "review threshold 140/90") is a config value, not a reading.
    const text = allText(await provider.generate(ctx)).replace(/threshold\s+\d{2,3}\/\d{2,3}/gi, '');
    const documented = new Set(ctx.visits.map((v) => `${v.bpSystolic}/${v.bpDiastolic}`));
    const cited = text.match(/\b\d{2,3}\/\d{2,3}\b/g) ?? [];
    for (const bp of cited) expect(documented, `BP ${bp} not in input`).toContain(bp);
  });

  it('only lists documented medications', async () => {
    const ctx = context();
    const out = await provider.generate(ctx);
    const documented = new Set(ctx.visits.flatMap((v) => v.medications));
    for (const m of out.medications) expect(documented, `medication ${m} not in input`).toContain(m);
  });

  it('renders missing values as "Not documented"', async () => {
    const out = await provider.generate(context());
    expect(allText(out)).toContain('Not documented');
  });

  it('handles a chart with no visits', async () => {
    const out = await provider.generate(context({ visits: [], allergies: [], medicalHistory: [], obstetricHistory: [] }));
    expect(qSummaryContentSchema.safeParse(out).success).toBe(true);
    expect(allText(out)).toContain('Not documented');
    expect(out.medications).toEqual([]);
  });

  it('fails on the [[mock-fail]] marker (used to test the AI failure path)', async () => {
    await expect(provider.generate(context({ reasonForReferral: 'Please fail [[mock-fail]]' }))).rejects.toThrow();
  });
});
