import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ReferralLinkResult, ReferralTokenDoc } from '../shared/contracts';
import { buildReferralUrl, computeExpiry, generateRawToken, hashToken, linkTtlHours } from '../lib/token';
import { tokenRef } from '../repositories';

export interface IssuedLink {
  /** Raw token: returned to the caller / placed in SMS only. NEVER stored or logged. */
  rawToken: string;
  tokenHash: string;
  expiresAtMillis: number;
  url: string;
}

export const LINK_CONFIG_ERROR_MESSAGE = 'Referral links are not configured on the server. Contact your system administrator.';

const EMULATOR_FALLBACK_URL = 'http://localhost:5173';

/**
 * Pure: resolves the hospital-link base URL. Outside the emulator APP_BASE_URL is required and must be https
 * (never silently fall back to localhost in production). Throws a user-safe HttpsError on misconfiguration.
 */
export function resolveAppBaseUrl(env: { APP_BASE_URL?: string; FUNCTIONS_EMULATOR?: string } = process.env): string {
  const emulator = env.FUNCTIONS_EMULATOR === 'true';
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) {
    if (emulator) {
      logger.warn(`APP_BASE_URL is not set; using ${EMULATOR_FALLBACK_URL} (emulator only)`);
      return EMULATOR_FALLBACK_URL;
    }
    logger.error('APP_BASE_URL is not set; refusing to issue referral links');
    throw new HttpsError('failed-precondition', LINK_CONFIG_ERROR_MESSAGE);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    logger.error('APP_BASE_URL is not a valid URL; refusing to issue referral links');
    throw new HttpsError('failed-precondition', LINK_CONFIG_ERROR_MESSAGE);
  }
  const allowedProtocol = parsed.protocol === 'https:' || (emulator && parsed.protocol === 'http:');
  if (!allowedProtocol) {
    logger.error('APP_BASE_URL must use https outside the emulator; refusing to issue referral links');
    throw new HttpsError('failed-precondition', LINK_CONFIG_ERROR_MESSAGE);
  }
  return raw;
}

export function appBaseUrl(): string {
  return resolveAppBaseUrl(process.env);
}

export function issueLink(nowMillis: number = Date.now()): IssuedLink {
  const rawToken = generateRawToken();
  const expiresAtMillis = computeExpiry(nowMillis, linkTtlHours(process.env.REFERRAL_LINK_TTL_HOURS));
  return { rawToken, tokenHash: hashToken(rawToken), expiresAtMillis, url: buildReferralUrl(appBaseUrl(), rawToken) };
}

export function tokenDoc(referralId: string, clinicId: string, link: IssuedLink, nowMillis: number): ReferralTokenDoc {
  return {
    referralId,
    clinicId,
    expiresAt: Timestamp.fromMillis(link.expiresAtMillis),
    revoked: false,
    createdAt: Timestamp.fromMillis(nowMillis),
    revokedAt: null,
  };
}

/** Writes the hashed token doc inside a transaction (create fails on the astronomically unlikely hash collision). */
export function createTokenInTx(tx: Transaction, referralId: string, clinicId: string, link: IssuedLink, nowMillis: number): void {
  tx.create(tokenRef(link.tokenHash), tokenDoc(referralId, clinicId, link, nowMillis));
}

export function linkResult(link: IssuedLink): ReferralLinkResult {
  return { url: link.url, expiresAtMillis: link.expiresAtMillis };
}
