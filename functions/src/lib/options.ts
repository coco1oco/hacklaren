import type { CallableOptions } from 'firebase-functions/v2/https';
import { smsSecrets } from '../services/sms/provider';

/**
 * Shared callable options. CORS is open (any origin) so the Vercel-hosted PWA can call cross-origin;
 * access is controlled by Firebase Auth custom claims or hospital link tokens, not by origin.
 */
export function callableOptions(opts: { sms?: boolean; memory?: CallableOptions['memory']; timeoutSeconds?: number } = {}): CallableOptions {
  return {
    cors: true,
    enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true',
    secrets: opts.sms ? smsSecrets() : [],
    ...(opts.memory ? { memory: opts.memory } : {}),
    ...(opts.timeoutSeconds ? { timeoutSeconds: opts.timeoutSeconds } : {}),
  };
}
