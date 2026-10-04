import { describe, expect, it } from 'vitest';
import { clientIp, referralLimitPerMinute, windowKey, windowStart } from './rateLimit';

const MINUTE = 60_000;
const t0 = 1_790_000_000_000 - (1_790_000_000_000 % MINUTE); // start of a minute

describe('windowKey', () => {
  it('is stable within the same minute', () => {
    expect(windowKey('203.0.113.7', 'view', t0)).toBe(windowKey('203.0.113.7', 'view', t0 + 59_999));
  });
  it('changes in the next minute', () => {
    expect(windowKey('203.0.113.7', 'view', t0)).not.toBe(windowKey('203.0.113.7', 'view', t0 + MINUTE));
  });
  it('differs per ip and per bucket', () => {
    const base = windowKey('203.0.113.7', 'view', t0);
    expect(windowKey('203.0.113.8', 'view', t0)).not.toBe(base);
    expect(windowKey('203.0.113.7', 'status', t0)).not.toBe(base);
  });
  it('does not contain the raw IP', () => {
    for (const ip of ['203.0.113.7', '2001:db8::1']) {
      const key = windowKey(ip, 'view', t0);
      expect(key).not.toContain(ip);
      expect(key).not.toContain(ip.replace(/[.:]/g, '_'));
      expect(key).not.toContain(ip.replace(/[.:]/g, '-'));
    }
  });
  it('is a valid Firestore document id', () => {
    const key = windowKey('203.0.113.7', 'view', t0);
    expect(key).not.toContain('/');
    expect(key.length).toBeGreaterThan(0);
    expect(key.length).toBeLessThanOrEqual(1500);
  });
});

describe('rate limit helpers', () => {
  it('windowStart floors to the minute', () => {
    expect(windowStart(t0 + 12_345)).toBe(t0);
  });
  it('referralLimitPerMinute defaults to 30 for missing/invalid config', () => {
    expect(referralLimitPerMinute(undefined)).toBe(30);
    expect(referralLimitPerMinute('abc')).toBe(30);
    expect(referralLimitPerMinute('0')).toBe(30);
    expect(referralLimitPerMinute('12.7')).toBe(12);
  });
  it('clientIp uses the first x-forwarded-for hop, then ip, then "unknown"', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }, ip: '10.0.0.2' })).toBe('198.51.100.1');
    expect(clientIp({ headers: {}, ip: '10.0.0.2' })).toBe('10.0.0.2');
    expect(clientIp(undefined)).toBe('unknown');
  });
});
