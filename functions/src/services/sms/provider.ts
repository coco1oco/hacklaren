import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/logger';
import type { SmsStatus } from '../../shared/contracts';
import { maskPhone, normalizePhMobile } from './messages';

/** Semaphore API key. Server-side only; never logged. */
export const SEMAPHORE_API_KEY = defineSecret('SEMAPHORE_API_KEY');

/** Secrets to bind to SMS-sending functions. Only binds the secret when Semaphore is selected so mock deploys need no secret. */
export function smsSecrets() {
  return (process.env.SMS_PROVIDER ?? 'mock').trim().toLowerCase() === 'semaphore' ? [SEMAPHORE_API_KEY] : [];
}

export interface SmsSendResult {
  providerMessageId: string | null;
  status: 'sent' | 'failed';
  error?: string;
}

export interface SmsStatusResult {
  status: SmsStatus;
  error?: string;
}

export interface SmsProvider {
  name: 'mock' | 'semaphore';
  send(to: string, message: string): Promise<SmsSendResult>;
  fetchStatus?(providerMessageId: string): Promise<SmsStatusResult>;
}

/** Development provider: logs the masked recipient only (never the message body, which may contain a link). */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock' as const;
  private counter = 0;

  async send(to: string, message: string): Promise<SmsSendResult> {
    this.counter += 1;
    logger.info('MockSms send', { to: maskPhone(to), length: message.length });
    return { providerMessageId: `mock-${Date.now()}-${this.counter}`, status: 'sent' };
  }
}

const SEMAPHORE_BASE = 'https://api.semaphore.co/api/v4/messages';

export function mapSemaphoreStatus(status: unknown): SmsStatus {
  const s = String(status ?? '').toLowerCase();
  // Semaphore "Sent" means handed to the carrier, not confirmed delivery. Only an explicit "delivered" counts as delivered.
  if (s === 'delivered') return 'delivered';
  if (s === 'failed' || s === 'refunded') return 'failed';
  return 'sent'; // sent/queued/pending/unknown → handed off, delivery unconfirmed
}

export class SemaphoreSmsProvider implements SmsProvider {
  readonly name = 'semaphore' as const;

  constructor(
    private readonly apiKey: () => string = () => SEMAPHORE_API_KEY.value(),
    private readonly senderName: string | undefined = process.env.SEMAPHORE_SENDER_NAME,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async send(to: string, message: string): Promise<SmsSendResult> {
    const number = normalizePhMobile(to);
    if (!number) return { providerMessageId: null, status: 'failed', error: 'Recipient is not a valid PH mobile number.' };
    const key = this.apiKey();
    if (!key) return { providerMessageId: null, status: 'failed', error: 'SMS provider is not configured.' };
    const body = new URLSearchParams({ apikey: key, number, message });
    if (this.senderName) body.set('sendername', this.senderName);
    try {
      const res = await this.fetchImpl(SEMAPHORE_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        logger.warn('Semaphore send failed', { to: maskPhone(number), httpStatus: res.status });
        return { providerMessageId: null, status: 'failed', error: `SMS provider returned HTTP ${res.status}.` };
      }
      const data: unknown = await res.json();
      const first = (Array.isArray(data) ? data[0] : data) as { message_id?: number | string; status?: string } | undefined;
      if (!first || first.message_id == null) return { providerMessageId: null, status: 'failed', error: 'SMS provider returned no message id.' };
      if (mapSemaphoreStatus(first.status) === 'failed') return { providerMessageId: String(first.message_id), status: 'failed', error: 'SMS provider rejected the message.' };
      return { providerMessageId: String(first.message_id), status: 'sent' };
    } catch (err) {
      logger.warn('Semaphore send error', { to: maskPhone(number), message: err instanceof Error ? err.name : 'error' });
      return { providerMessageId: null, status: 'failed', error: 'SMS provider unreachable.' };
    }
  }

  async fetchStatus(providerMessageId: string): Promise<SmsStatusResult> {
    const url = `${SEMAPHORE_BASE}/${encodeURIComponent(providerMessageId)}?apikey=${encodeURIComponent(this.apiKey())}`;
    try {
      const res = await this.fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { status: 'sent' };
      const data: unknown = await res.json();
      const first = (Array.isArray(data) ? data[0] : data) as { status?: string } | undefined;
      const status = mapSemaphoreStatus(first?.status);
      return status === 'failed' ? { status, error: 'Delivery failed (provider report).' } : { status };
    } catch {
      return { status: 'sent' };
    }
  }
}

export function getSmsProvider(configured: string | undefined = process.env.SMS_PROVIDER): SmsProvider {
  const name = (configured ?? 'mock').trim().toLowerCase() || 'mock';
  if (name === 'mock') return new MockSmsProvider();
  if (name === 'semaphore') return new SemaphoreSmsProvider();
  throw new Error(`Unsupported SMS_PROVIDER "${name}". Use "mock" or "semaphore".`);
}
