import { describe, expect, it } from 'vitest';
import { buildReferralUrl, computeExpiry, generateRawToken, hashesEqual, hashToken, isExpired, linkTtlHours } from './token';
import { rawTokenSchema } from '../shared/schemas';

describe('referral tokens', () => {
  it('generates unique 256-bit base64url tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateRawToken();
      expect(rawTokenSchema.safeParse(t).success).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });
  it('hashes deterministically with SHA-256 and never returns the raw token', () => {
    const t = generateRawToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashToken(t));
    expect(h).not.toContain(t);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashesEqual(h, hashToken(t))).toBe(true);
    expect(hashesEqual(h, hashToken(generateRawToken()))).toBe(false);
  });
  it('clamps TTL to 24–72h and computes expiry', () => {
    expect(linkTtlHours('12')).toBe(24);
    expect(linkTtlHours('100')).toBe(72);
    expect(linkTtlHours(undefined)).toBe(48);
    const now = 1_000_000;
    const exp = computeExpiry(now, 24);
    expect(exp - now).toBe(24 * 3_600_000);
    expect(isExpired(exp, exp - 1)).toBe(false);
    expect(isExpired(exp, exp)).toBe(true);
  });
  it('builds the hospital URL', () => {
    expect(buildReferralUrl('https://mara.vercel.app/', 'tok')).toBe('https://mara.vercel.app/referral/tok');
  });
});
