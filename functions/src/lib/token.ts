import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes (256 bits) of CSPRNG output, base64url-encoded → 43 URL-safe characters. */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex digest. This hash (never the raw token) is what gets stored in Firestore. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Link lifetime clamped to the MVP window of 24–72 hours. */
export function linkTtlHours(configured: string | undefined): number {
  const n = Number(configured);
  if (!Number.isFinite(n)) return 48;
  return Math.min(72, Math.max(24, Math.round(n)));
}

export function computeExpiry(nowMillis: number, ttlHours: number): number {
  return nowMillis + ttlHours * 3_600_000;
}

export function isExpired(expiresAtMillis: number, nowMillis: number): boolean {
  return nowMillis >= expiresAtMillis;
}

export function buildReferralUrl(appBaseUrl: string, rawToken: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/referral/${rawToken}`;
}
