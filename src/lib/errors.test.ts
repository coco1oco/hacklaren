import { describe, expect, it } from 'vitest';
import { authMessage, isNetworkError, maraCode, userMessage } from './errors';
import type { MaraErrorCode } from '@shared/contracts';

const httpsError = (code: string, maraErr?: MaraErrorCode) => ({ code, message: 'internal stack trace at foo.ts:12', details: maraErr ? { code: maraErr } : undefined });

describe('maraCode', () => {
  it('reads details.code when it is a known MaraErrorCode', () => {
    expect(maraCode(httpsError('functions/failed-precondition', 'CONSENT_REQUIRED'))).toBe('CONSENT_REQUIRED');
    expect(maraCode({ details: { code: 'SOMETHING_ELSE' } })).toBeNull();
    expect(maraCode(new Error('x'))).toBeNull();
    expect(maraCode(null)).toBeNull();
  });
});

describe('userMessage', () => {
  it('maps every MaraErrorCode to a readable message', () => {
    const codes: MaraErrorCode[] = ['CONSENT_REQUIRED', 'HOSPITAL_NOT_ELIGIBLE', 'INVALID_TRANSITION', 'SUMMARY_NOT_READY', 'NOT_FOUND', 'FORBIDDEN', 'VALIDATION'];
    for (const c of codes) {
      const m = userMessage(httpsError('functions/failed-precondition', c), 'fallback');
      expect(m).not.toBe('fallback');
      expect(m).not.toContain('stack trace');
    }
  });
  it('maps functions error codes', () => {
    expect(userMessage(httpsError('functions/unauthenticated'), 'f')).toMatch(/sign in/i);
    expect(userMessage(httpsError('functions/resource-exhausted'), 'f')).toMatch(/too many/i);
    expect(userMessage(httpsError('functions/unavailable'), 'f')).toMatch(/connection|unreachable/i);
  });
  it('falls back without leaking raw server errors', () => {
    expect(userMessage(httpsError('functions/internal'), 'Something went wrong.')).toBe('Something went wrong.');
    expect(userMessage('boom', 'Something went wrong.')).toBe('Something went wrong.');
  });
});

describe('isNetworkError', () => {
  it('detects connectivity failures only', () => {
    expect(isNetworkError(httpsError('functions/unavailable'))).toBe(true);
    expect(isNetworkError(httpsError('functions/deadline-exceeded'))).toBe(true);
    expect(isNetworkError(httpsError('functions/permission-denied'))).toBe(false);
  });
});

describe('authMessage', () => {
  it('does not reveal whether the email exists', () => {
    expect(authMessage({ code: 'auth/user-not-found' })).toBe(authMessage({ code: 'auth/wrong-password' }));
    expect(authMessage({ code: 'auth/invalid-credential' })).toBe('Incorrect email or password.');
  });
  it('explains deactivated accounts and unknown errors', () => {
    expect(authMessage({ code: 'auth/user-disabled' })).toMatch(/deactivated/i);
    expect(authMessage({})).toBe('Unable to sign in. Please try again.');
  });
});
