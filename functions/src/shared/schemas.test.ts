import { describe, expect, it } from 'vitest';
import { emergencyReferralInputSchema, patientInputSchema, qSummaryContentSchema, rawTokenSchema, visitClinicalSchema } from './schemas';
import { abnormalTrends, outsideExpectedRange, visitRiskFlags } from './riskFlags';
import { newPatientId, PATIENT_ID_PATTERN } from './ids';
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
  medications: ['Ferrous sulfate'],
  notes: '',
  dangerSigns: { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false },
  ...overrides,
});

describe('visitClinicalSchema', () => {
  it('accepts a normal visit', () => {
    expect(visitClinicalSchema.safeParse(visit()).success).toBe(true);
  });
  it('accepts abnormal but possible values', () => {
    expect(visitClinicalSchema.safeParse(visit({ bpSystolic: 190, bpDiastolic: 125 })).success).toBe(true);
  });
  it('rejects physically impossible values', () => {
    expect(visitClinicalSchema.safeParse(visit({ bpSystolic: 500 })).success).toBe(false);
    expect(visitClinicalSchema.safeParse(visit({ weightKg: -3 })).success).toBe(false);
    expect(visitClinicalSchema.safeParse(visit({ bpSystolic: 80, bpDiastolic: 90 })).success).toBe(false);
    expect(visitClinicalSchema.safeParse(visit({ visitDate: '2026-13-01' })).success).toBe(false);
  });
  it('flags out-of-expected-range values for a warning', () => {
    expect(outsideExpectedRange('bpSystolic', 240)).toBe(true);
    expect(outsideExpectedRange('bpSystolic', 120)).toBe(false);
    expect(outsideExpectedRange('fhr', null)).toBe(false);
  });
});

describe('risk flags', () => {
  it('uses non-diagnostic wording', () => {
    const flags = visitRiskFlags(visit({ bpSystolic: 155, bpDiastolic: 100, fhr: 100, urineProtein: '2+', dangerSigns: { bleeding: true, severeHeadache: false, blurredVision: false, reducedFetalMovement: false } }));
    expect(flags.map((f) => f.code)).toEqual(['bp_high', 'fhr_low', 'urine_protein', 'danger_sign']);
    for (const f of flags) {
      expect(f.detail).toMatch(/clinical review/);
      expect(f.detail.toLowerCase()).not.toMatch(/preeclampsia|diagnos/);
    }
  });
  it('describes rising BP trend', () => {
    const trends = abnormalTrends([
      visit({ visitDate: '2026-08-01', bpSystolic: 130, bpDiastolic: 85 }),
      visit({ visitDate: '2026-09-20', bpSystolic: 148, bpDiastolic: 94 }),
      visit({ visitDate: '2026-10-04', bpSystolic: 155, bpDiastolic: 100 }),
    ]);
    expect(trends.some((t) => t.startsWith('Systolic BP increased'))).toBe(true);
  });
});

describe('patientInputSchema', () => {
  const valid = {
    name: 'Maria Santos',
    birthdate: '1999-05-12',
    address: '123 Sampaguita St.',
    barangay: 'San Isidro',
    contactNumber: '09171234567',
    emergencyContact: { name: 'Jose Santos', relationship: 'Husband', contactNumber: '+639171234568' },
    pregnancy: { lmp: '2026-03-10', edd: '2026-12-15', gravida: 3, para: 2 },
    allergies: [],
    bloodType: 'O+' as const,
    medicalHistory: [],
    obstetricHistory: [],
    consentGiven: true,
  };
  it('accepts valid input', () => {
    expect(patientInputSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects malformed phone and para >= gravida', () => {
    expect(patientInputSchema.safeParse({ ...valid, contactNumber: '12345' }).success).toBe(false);
    expect(patientInputSchema.safeParse({ ...valid, pregnancy: { ...valid.pregnancy, para: 3 } }).success).toBe(false);
  });
});

describe('referral + summary schemas', () => {
  it('requires free text for "other"', () => {
    const base = { patientId: 'MARA-PAT-2841', hospitalId: 'h1', reasonCode: 'other', reasonText: '', clientRequestId: '6f1c1f0e-2a7b-4c2e-9d3a-0b6f1c1f0e2a' };
    expect(emergencyReferralInputSchema.safeParse(base).success).toBe(false);
    expect(emergencyReferralInputSchema.safeParse({ ...base, reasonText: 'Cord prolapse suspected by midwife' }).success).toBe(true);
  });
  it('validates AI output structure', () => {
    expect(qSummaryContentSchema.safeParse({ summary: 'x' }).success).toBe(false);
    expect(
      qSummaryContentSchema.safeParse({ summary: 's', keyFindings: [], riskFlags: [], medications: [], reasonForReferral: 'r', abnormalTrends: [] }).success,
    ).toBe(true);
  });
  it('validates raw token format', () => {
    expect(rawTokenSchema.safeParse('a'.repeat(43)).success).toBe(true);
    expect(rawTokenSchema.safeParse('a'.repeat(42)).success).toBe(false);
    expect(rawTokenSchema.safeParse('../../etc/passwd' + 'a'.repeat(27)).success).toBe(false);
  });
});

describe('ids', () => {
  it('generates valid patient ids', () => {
    for (let i = 0; i < 50; i++) expect(newPatientId()).toMatch(PATIENT_ID_PATTERN);
    expect('MARA-PAT-2841').toMatch(PATIENT_ID_PATTERN);
  });
});
