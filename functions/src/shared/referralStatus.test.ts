import { describe, expect, it } from 'vitest';
import { allowedHospitalActions, canTransition, filterForStatus } from './referralStatus';

describe('canTransition', () => {
  it('allows the main flow', () => {
    expect(canTransition('checkup', 'CREATED', 'SENT', 'midwife').allowed).toBe(true);
    expect(canTransition('checkup', 'SENT', 'ACKNOWLEDGED', 'hospital').allowed).toBe(true);
    expect(canTransition('checkup', 'ACKNOWLEDGED', 'ARRIVED', 'hospital').allowed).toBe(true);
  });
  it('restricts decline to checkup referrals', () => {
    expect(canTransition('checkup', 'SENT', 'DECLINED', 'hospital').allowed).toBe(true);
    expect(canTransition('emergency', 'SENT', 'DECLINED', 'hospital').allowed).toBe(false);
  });
  it('lets emergency patients arrive before acknowledgement, but not checkup', () => {
    expect(canTransition('emergency', 'SENT', 'ARRIVED', 'hospital').allowed).toBe(true);
    expect(canTransition('checkup', 'SENT', 'ARRIVED', 'hospital').allowed).toBe(false);
  });
  it('enforces actors', () => {
    expect(canTransition('checkup', 'SENT', 'ACKNOWLEDGED', 'midwife').allowed).toBe(false);
    expect(canTransition('checkup', 'SENT', 'CANCELLED', 'hospital').allowed).toBe(false);
    expect(canTransition('checkup', 'SENT', 'EXPIRED', 'system').allowed).toBe(true);
    expect(canTransition('checkup', 'SENT', 'EXPIRED', 'hospital').allowed).toBe(false);
  });
  it('blocks transitions out of terminal states', () => {
    for (const s of ['ARRIVED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(canTransition('checkup', s, 'ACKNOWLEDGED', 'hospital').allowed).toBe(false);
      expect(canTransition('emergency', s, 'CANCELLED', 'midwife').allowed).toBe(false);
    }
  });
  it('blocks skipping and backwards moves', () => {
    expect(canTransition('checkup', 'CREATED', 'ACKNOWLEDGED', 'hospital').allowed).toBe(false);
    expect(canTransition('checkup', 'ACKNOWLEDGED', 'SENT', 'midwife').allowed).toBe(false);
  });
});

describe('allowedHospitalActions', () => {
  it('lists actions per type/state', () => {
    expect(allowedHospitalActions('checkup', 'SENT')).toEqual(['ACKNOWLEDGED', 'DECLINED']);
    expect(allowedHospitalActions('emergency', 'SENT')).toEqual(['ACKNOWLEDGED', 'ARRIVED']);
    expect(allowedHospitalActions('checkup', 'ACKNOWLEDGED')).toEqual(['ARRIVED']);
    expect(allowedHospitalActions('checkup', 'CREATED')).toEqual([]);
    expect(allowedHospitalActions('emergency', 'ARRIVED')).toEqual([]);
  });
});

describe('filterForStatus', () => {
  it('groups statuses', () => {
    expect(filterForStatus('SENT')).toBe('active');
    expect(filterForStatus('ARRIVED')).toBe('completed');
    expect(filterForStatus('EXPIRED')).toBe('expired');
  });
});
