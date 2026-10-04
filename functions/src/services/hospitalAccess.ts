import type { CallableRequest } from 'firebase-functions/v2/https';
import type { ReferralDoc, ReferralTokenDoc } from '../shared/contracts';
import { rawTokenSchema } from '../shared/schemas';
import { hashToken, isExpired } from '../lib/token';
import { INVALID_TOKEN_LIMIT_PER_MINUTE, clientIp, consumeRateLimit, isOverLimit, referralLimitPerMinute } from '../lib/rateLimit';
import { MESSAGES, maraError } from '../lib/errors';
import { getReferral, getToken } from '../repositories';

export type TokenFailure = 'expired' | 'revoked' | 'invalid' | 'rate_limited';

export type TokenResolution =
  | { ok: true; tokenHash: string; token: ReferralTokenDoc; referral: ReferralDoc; ip: string }
  | { ok: false; reason: TokenFailure };

/** Pure decision on a token doc (exported for tests). */
export function tokenState(token: Pick<ReferralTokenDoc, 'revoked' | 'expiresAt'> | null, nowMillis: number): 'ok' | 'invalid' | 'revoked' | 'expired' {
  if (!token) return 'invalid';
  if (token.revoked) return 'revoked';
  if (isExpired(token.expiresAt.toMillis(), nowMillis)) return 'expired';
  return 'ok';
}

/**
 * Hospital access gate (no Firebase Auth): rate limit by IP BEFORE any lookup, validate token format,
 * hash, then look up referralTokens/{hash}. Non-ok results carry no patient data.
 */
export async function resolveHospitalToken(request: Pick<CallableRequest<unknown>, 'rawRequest'>, rawToken: unknown, nowMillis = Date.now()): Promise<TokenResolution> {
  const ip = clientIp(request.rawRequest as unknown as { ip?: string; headers?: Record<string, string | string[] | undefined> });
  if (await isOverLimit(ip, 'invalid_token', INVALID_TOKEN_LIMIT_PER_MINUTE, nowMillis)) return { ok: false, reason: 'rate_limited' };
  if (!(await consumeRateLimit(ip, 'referral', referralLimitPerMinute(), nowMillis))) return { ok: false, reason: 'rate_limited' };

  const parsed = rawTokenSchema.safeParse(rawToken);
  if (!parsed.success) {
    await consumeRateLimit(ip, 'invalid_token', INVALID_TOKEN_LIMIT_PER_MINUTE, nowMillis);
    return { ok: false, reason: 'invalid' };
  }
  const tokenHash = hashToken(parsed.data);
  const token = await getToken(tokenHash);
  const state = tokenState(token, nowMillis);
  if (state === 'invalid' || !token) {
    await consumeRateLimit(ip, 'invalid_token', INVALID_TOKEN_LIMIT_PER_MINUTE, nowMillis);
    return { ok: false, reason: 'invalid' };
  }
  if (state !== 'ok') return { ok: false, reason: state };

  const referral = await getReferral(token.referralId);
  if (!referral) return { ok: false, reason: 'invalid' };
  if (referral.link?.revoked || referral.status === 'CANCELLED') return { ok: false, reason: 'revoked' };
  if (referral.status === 'EXPIRED') return { ok: false, reason: 'expired' };
  return { ok: true, tokenHash, token, referral, ip };
}

/** For callables that must throw (status update / PDF) instead of returning { ok:false }. */
export function tokenFailureError(reason: TokenFailure) {
  switch (reason) {
    case 'rate_limited':
      return maraError('resource-exhausted', 'FORBIDDEN', MESSAGES.rateLimited, { reason });
    case 'expired':
      return maraError('permission-denied', 'FORBIDDEN', MESSAGES.linkExpired, { reason });
    case 'revoked':
      return maraError('permission-denied', 'FORBIDDEN', MESSAGES.linkRevoked, { reason });
    default:
      return maraError('permission-denied', 'FORBIDDEN', MESSAGES.linkInvalid, { reason });
  }
}
