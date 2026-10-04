import { Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../shared/contracts';
import { db } from './firebase';
import { hashToken } from './token';

export const WINDOW_MS = 60_000;
/** Stricter bucket: invalid/unknown token attempts per IP per minute. */
export const INVALID_TOKEN_LIMIT_PER_MINUTE = 10;

export type RateLimitBucket = 'referral' | 'invalid_token' | 'join_code' | 'register_clinic';

/** Wrong server-code attempts allowed per user per minute (brute-force protection for joinClinic). */
export const JOIN_CODE_LIMIT_PER_MINUTE = 5;
/** Clinic registrations allowed per IP per minute. */
export const REGISTER_CLINIC_LIMIT_PER_MINUTE = 3;

export function windowStart(nowMillis: number): number {
  return Math.floor(nowMillis / WINDOW_MS) * WINDOW_MS;
}

/** Doc id for a (ip, bucket, fixed 1-minute window). The IP is hashed so it is never stored in clear. */
export function windowKey(ip: string, bucket: string, nowMillis: number): string {
  return `${hashToken(`${ip}|${bucket}`)}_${windowStart(nowMillis)}`;
}

export function referralLimitPerMinute(configured: string | undefined = process.env.REFERRAL_RATE_LIMIT_PER_MINUTE): number {
  const n = Number(configured);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
}

/** First hop of x-forwarded-for, else the socket/express ip. */
export function clientIp(rawRequest: { ip?: string; headers?: Record<string, string | string[] | undefined> } | undefined): string {
  const xff = rawRequest?.headers?.['x-forwarded-for'];
  const header = Array.isArray(xff) ? xff[0] : xff;
  const first = header?.split(',')[0]?.trim();
  return first || rawRequest?.ip || 'unknown';
}

/** Increments the counter and returns true when the request is within the limit. */
export async function consumeRateLimit(ip: string, bucket: RateLimitBucket, limit: number, nowMillis = Date.now()): Promise<boolean> {
  const ref = db().collection(COLLECTIONS.rateLimits).doc(windowKey(ip, bucket, nowMillis));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? Number(snap.get('count') ?? 0) : 0;
    if (count >= limit) return false;
    const start = windowStart(nowMillis);
    tx.set(ref, { bucket, count: count + 1, windowStart: Timestamp.fromMillis(start), expiresAt: Timestamp.fromMillis(start + 2 * WINDOW_MS) });
    return true;
  });
}

/** Read-only check (does not increment). */
export async function isOverLimit(ip: string, bucket: RateLimitBucket, limit: number, nowMillis = Date.now()): Promise<boolean> {
  const snap = await db().collection(COLLECTIONS.rateLimits).doc(windowKey(ip, bucket, nowMillis)).get();
  return snap.exists && Number(snap.get('count') ?? 0) >= limit;
}
