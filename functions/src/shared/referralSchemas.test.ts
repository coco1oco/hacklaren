import { describe, expect, it } from 'vitest';
import { checkupReferralInputSchema, declineReasonSchema, hospitalInputSchema, phMobile, phoneNumber } from './schemas';

const uuid = '6f1c1f0e-2a7b-4c2e-9d3a-0b6f1c1f0e2a';

describe('checkupReferralInputSchema', () => {
  const valid = { patientId: 'MARA-PAT-2841', hospitalId: 'h1', reasonText: 'Rising BP across visits', clientRequestId: uuid };
  it('accepts valid input and trims reason', () => {
    const r = checkupReferralInputSchema.safeParse({ ...valid, reasonText: '  Rising BP  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reasonText).toBe('Rising BP');
  });
  it('requires a reason', () => {
    expect(checkupReferralInputSchema.safeParse({ ...valid, reasonText: '   ' }).success).toBe(false);
  });
  it('requires a UUID idempotency key', () => {
    expect(checkupReferralInputSchema.safeParse({ ...valid, clientRequestId: 'abc' }).success).toBe(false);
  });
  it('requires patient and hospital', () => {
    expect(checkupReferralInputSchema.safeParse({ ...valid, patientId: '' }).success).toBe(false);
    expect(checkupReferralInputSchema.safeParse({ ...valid, hospitalId: '' }).success).toBe(false);
  });
  it('limits reason length', () => {
    expect(checkupReferralInputSchema.safeParse({ ...valid, reasonText: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('declineReasonSchema', () => {
  it('requires at least 3 characters after trimming', () => {
    expect(declineReasonSchema.safeParse('  ab  ').success).toBe(false);
    expect(declineReasonSchema.safeParse('No OB bed available').success).toBe(true);
  });
  it('limits length', () => {
    expect(declineReasonSchema.safeParse('x'.repeat(1001)).success).toBe(false);
  });
});

describe('hospitalInputSchema', () => {
  const valid = {
    name: 'Provincial Hospital',
    address: 'Capitol Rd',
    phone: '(044) 123-4567',
    referralLevel: 2,
    services: ['CEmONC', 'NICU'],
    latitude: 14.6,
    longitude: 121,
    dohNetworked: true,
    active: true,
  };
  it('accepts a valid hospital', () => {
    expect(hospitalInputSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects invalid level, service and coordinates', () => {
    expect(hospitalInputSchema.safeParse({ ...valid, referralLevel: 4 }).success).toBe(false);
    expect(hospitalInputSchema.safeParse({ ...valid, services: ['Spa'] }).success).toBe(false);
    expect(hospitalInputSchema.safeParse({ ...valid, latitude: 91 }).success).toBe(false);
    expect(hospitalInputSchema.safeParse({ ...valid, longitude: -181 }).success).toBe(false);
  });
  it('rejects a malformed phone', () => {
    expect(hospitalInputSchema.safeParse({ ...valid, phone: 'call us' }).success).toBe(false);
  });
});

describe('phone schemas', () => {
  it('phMobile accepts 09 and +639 formats only', () => {
    expect(phMobile.safeParse('09171234567').success).toBe(true);
    expect(phMobile.safeParse('+639171234567').success).toBe(true);
    expect(phMobile.safeParse('9171234567').success).toBe(false);
    expect(phMobile.safeParse('0917123456').success).toBe(false);
  });
  it('phoneNumber accepts landlines', () => {
    expect(phoneNumber.safeParse('(044) 123-4567').success).toBe(true);
    expect(phoneNumber.safeParse('12').success).toBe(false);
  });
});
