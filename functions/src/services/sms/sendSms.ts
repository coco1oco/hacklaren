import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/logger';
import type { SmsLogDoc, SmsMessageType, SmsRecipientRole, SmsStatus } from '../../shared/contracts';
import type { Role } from '../../shared/types';
import { writeAudit } from '../../lib/audit';
import { getSmsLog, newSmsLogRef, smsLogRef } from '../../repositories';
import { maskPhone, normalizePhMobile, redactLinks } from './messages';
import { getSmsProvider, type SmsProvider } from './provider';

export interface SendSmsInput {
  recipient: string;
  recipientRole: SmsRecipientRole;
  messageType: SmsMessageType;
  referralId: string;
  clinicId: string;
  /** Actual body sent. Any /referral/<token> link is redacted before storage. */
  message: string;
}

export interface SendSmsOutcome {
  smsLogId: string | null;
  status: SmsStatus;
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Logs + sends one SMS. Never throws: SMS failures must not break referral flows.
 * The stored message has link tokens redacted so raw tokens never reach Firestore.
 */
export async function sendSms(input: SendSmsInput, provider?: SmsProvider): Promise<SendSmsOutcome> {
  let smsLogId: string | null = null;
  try {
    const p = provider ?? getSmsProvider();
    const normalized = normalizePhMobile(input.recipient);
    const recipient = normalized ?? input.recipient;
    const ref = newSmsLogRef();
    smsLogId = ref.id;
    const log: SmsLogDoc = {
      recipient,
      recipientMasked: maskPhone(recipient),
      recipientRole: input.recipientRole,
      messageType: input.messageType,
      message: redactLinks(input.message),
      referralId: input.referralId,
      clinicId: input.clinicId,
      provider: p.name,
      status: 'queued',
      providerMessageId: null,
      createdAt: Timestamp.now(),
      sentAt: null,
      deliveredAt: null,
      failedAt: null,
      error: null,
      retryCount: 0,
    };
    await ref.set(log);

    const result = normalized
      ? await p.send(normalized, input.message).catch((e: unknown) => ({ providerMessageId: null, status: 'failed' as const, error: errMsg(e) }))
      : { providerMessageId: null, status: 'failed' as const, error: 'Recipient is not a valid PH mobile number.' };

    if (result.status === 'sent') {
      await ref.update({ status: 'sent', providerMessageId: result.providerMessageId, sentAt: Timestamp.now(), error: null });
    } else {
      await ref.update({ status: 'failed', providerMessageId: result.providerMessageId, failedAt: Timestamp.now(), error: result.error ?? 'SMS failed.' });
    }
    await writeAudit({
      action: result.status === 'sent' ? 'sms_sent' : 'sms_failed',
      actorKind: 'system',
      actorUid: null,
      actorRole: null,
      clinicId: input.clinicId,
      patientId: null,
      referralId: input.referralId,
      details: { channel: 'sms', messageType: input.messageType, recipientRole: input.recipientRole, provider: p.name, smsLogId },
    });
    return { smsLogId, status: result.status };
  } catch (err) {
    logger.error('sendSms failed', { referralId: input.referralId, messageType: input.messageType, message: errMsg(err) });
    return { smsLogId, status: 'failed' };
  }
}

/** Sends several SMS in parallel; never rejects. */
export async function sendAll(inputs: (SendSmsInput | null)[]): Promise<SendSmsOutcome[]> {
  const list = inputs.filter((i): i is SendSmsInput => i !== null);
  const settled = await Promise.allSettled(list.map((i) => sendSms(i)));
  return settled.map((s) => (s.status === 'fulfilled' ? s.value : { smsLogId: null, status: 'failed' as const }));
}

/** Re-sends an existing smsLog (retryCount++). Caller must have checked clinic access and that it is not a link SMS. */
export async function resendSmsLog(smsLogId: string, actor: { uid: string; role: Role }): Promise<SmsStatus> {
  const log = await getSmsLog(smsLogId);
  if (!log) throw new Error('smsLog not found');
  const p = getSmsProvider();
  const ref = smsLogRef(smsLogId);
  const result = await p.send(log.recipient, log.message).catch((e: unknown) => ({ providerMessageId: null, status: 'failed' as const, error: errMsg(e) }));
  const retryCount = (log.retryCount ?? 0) + 1;
  if (result.status === 'sent') {
    await ref.update({ status: 'sent', provider: p.name, providerMessageId: result.providerMessageId, sentAt: Timestamp.now(), failedAt: null, deliveredAt: null, error: null, retryCount });
  } else {
    await ref.update({ status: 'failed', provider: p.name, failedAt: Timestamp.now(), error: result.error ?? 'SMS failed.', retryCount });
  }
  await writeAudit({
    action: result.status === 'sent' ? 'sms_sent' : 'sms_failed',
    actorKind: 'user',
    actorUid: actor.uid,
    actorRole: actor.role,
    clinicId: log.clinicId,
    patientId: null,
    referralId: log.referralId,
    details: { channel: 'sms', messageType: log.messageType, recipientRole: log.recipientRole, provider: p.name, smsLogId, retry: retryCount },
  });
  return result.status;
}
