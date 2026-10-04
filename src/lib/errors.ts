import type { MaraErrorCode } from '@shared/contracts';

const MARA_MESSAGES: Record<MaraErrorCode, string> = {
  CONSENT_REQUIRED:
    'This patient has not consented to sharing her record for referral. Record consent on the patient profile before sending a checkup referral.',
  HOSPITAL_NOT_ELIGIBLE: 'This hospital cannot receive this type of referral. Please choose another hospital.',
  INVALID_TRANSITION: "This action is no longer available for the referral's current status. Please refresh and check the latest status.",
  SUMMARY_NOT_READY: 'The summary is not ready yet. Generate or retry the summary first.',
  NOT_FOUND: 'The record was not found. It may have been removed, or you may not have access.',
  FORBIDDEN: 'You do not have permission to do this.',
  VALIDATION: 'Some information is missing or invalid. Please check the form and try again.',
};

function rawCode(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') return (e as { code: string }).code;
  return '';
}

/** MaraErrorCode carried in HttpsError.details.code, if any. */
export function maraCode(e: unknown): MaraErrorCode | null {
  if (!e || typeof e !== 'object' || !('details' in e)) return null;
  const details = (e as { details: unknown }).details;
  if (details && typeof details === 'object' && 'code' in details) {
    const c = (details as { code: unknown }).code;
    if (typeof c === 'string' && c in MARA_MESSAGES) return c as MaraErrorCode;
  }
  return null;
}

/** True when the failure is a connectivity problem (safe to queue / retry later). */
export function isNetworkError(e: unknown): boolean {
  const c = rawCode(e);
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    c === 'functions/unavailable' ||
    c === 'functions/deadline-exceeded' ||
    c === 'unavailable' ||
    c === 'deadline-exceeded'
  );
}

/**
 * For callables whose error messages are written to be user-facing (onboarding): show the server's message when it
 * carries a MARA error code (those messages never contain stack traces), otherwise fall back to userMessage().
 */
export function serverMessage(e: unknown, fallback: string): string {
  if (maraCode(e) && e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message: unknown }).message ?? '').trim();
    if (msg && msg.length <= 300) return msg;
  }
  return userMessage(e, fallback);
}

/** User-readable message. Never exposes stack traces or raw server errors. */
export function userMessage(e: unknown, fallback: string): string {
  const m = maraCode(e);
  if (m) return MARA_MESSAGES[m];
  const c = rawCode(e).replace(/^functions\//, '');
  switch (c) {
    case 'unauthenticated':
      return 'Your session has ended. Please sign in again.';
    case 'permission-denied':
      return MARA_MESSAGES.FORBIDDEN;
    case 'resource-exhausted':
      return 'Too many requests. Please wait a minute and try again.';
    case 'invalid-argument':
      return MARA_MESSAGES.VALIDATION;
    case 'not-found':
      return MARA_MESSAGES.NOT_FOUND;
    case 'unavailable':
    case 'deadline-exceeded':
      return 'No internet connection or the server is unreachable. Please try again when you are online.';
    default:
      return fallback;
  }
}

export function authMessage(e: unknown): string {
  switch (rawCode(e)) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Incorrect email or password.';
    case 'auth/user-disabled':
      return 'This account has been deactivated. Please contact your clinic administrator.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No internet connection. Signing in requires a connection.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Choose a stronger password (at least 8 characters).';
    default:
      return 'Unable to sign in. Please try again.';
  }
}
