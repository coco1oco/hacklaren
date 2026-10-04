import { logger } from 'firebase-functions/logger';
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import type { ZodType } from 'zod';
import type { MaraErrorCode } from '../shared/contracts';

/** User-readable messages. Never include stack traces, internal ids of other clinics, or clinical values. */
export const MESSAGES = {
  generic: 'Something went wrong. Your patient record has not been lost. Please check your connection and try again.',
  sendFailed: 'Unable to send referral. Your patient record has not been lost. Please check your connection and try again.',
  aiUnavailable: 'AI summary unavailable. Review the raw chart manually. Retry summary.',
  unauthenticated: 'Please sign in to continue.',
  forbidden: 'You do not have access to this record.',
  inactive: 'Your account is inactive. Contact your clinic administrator.',
  notFound: 'Record not found.',
  rateLimited: 'Too many requests. Please wait a minute and try again.',
  linkInvalid: 'This referral link is not valid.',
  linkExpired: 'This referral link has expired. Please contact the referring clinic.',
  linkRevoked: 'This referral link has been revoked. Please contact the referring clinic.',
} as const;

export function maraError(
  code: FunctionsErrorCode,
  maraCode: MaraErrorCode,
  userMessage: string,
  extra?: Record<string, string | number | boolean | null>,
): HttpsError {
  return new HttpsError(code, userMessage, { code: maraCode, ...(extra ?? {}) });
}

/** Validates untrusted callable input with a shared zod schema. */
export function parseInput<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    throw maraError('invalid-argument', 'VALIDATION', first?.message && first.message.length < 200 ? first.message : 'Some fields are invalid. Please review and try again.');
  }
  return result.data;
}

/** Converts unexpected errors to a generic HttpsError (logs only the message, never request data). */
export function toHttpsError(err: unknown, fallbackMessage: string = MESSAGES.generic): HttpsError {
  if (err instanceof HttpsError) return err;
  logger.error('Unhandled function error', { message: err instanceof Error ? err.message : String(err) });
  return new HttpsError('internal', fallbackMessage);
}

/** Wraps a callable handler so only HttpsErrors with safe messages reach the client. */
export function safeHandler<Req, Res>(handler: (req: Req) => Promise<Res>, fallbackMessage?: string): (req: Req) => Promise<Res> {
  return async (req: Req) => {
    try {
      return await handler(req);
    } catch (err) {
      throw toHttpsError(err, fallbackMessage);
    }
  };
}
