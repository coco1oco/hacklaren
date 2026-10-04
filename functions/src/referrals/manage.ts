// Clinic-side referral management: cancel, revoke link, resend (rotate) link, resend SMS.
import { Timestamp } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import type {
  CancelReferralRequest,
  CancelReferralResponse,
  ResendReferralLinkRequest,
  ResendReferralLinkResponse,
  ResendSmsRequest,
  ResendSmsResponse,
  RevokeReferralLinkRequest,
  RevokeReferralLinkResponse,
} from '../shared/contracts';
import type { ReferralStatus } from '../shared/types';
import { canTransition } from '../shared/referralStatus';
import { assertClinicAccess, assertReferralWorker, requireStaff } from '../lib/auth';
import { auditInTx } from '../lib/audit';
import { db } from '../lib/firebase';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { getReferral, getSmsLog, referralRef } from '../repositories';
import { createTokenInTx, issueLink, linkResult, type IssuedLink } from '../services/links';
import * as sms from '../services/sms/messages';
import { resendSmsLog, sendSms } from '../services/sms/sendSms';
import { readActiveTokens, revokeTokensInTx } from './core';

const idSchema = z.object({ referralId: z.string().trim().min(1).max(64) });

export const cancelReferral = onCall<CancelReferralRequest>(callableOptions(), async (request): Promise<CancelReferralResponse> => {
  try {
    const ctx = await requireStaff(request);
    const input = parseInput(z.object({ referralId: z.string().trim().min(1).max(64), reason: z.string().trim().min(3, { message: 'A cancellation reason is required.' }).max(1000) }), request.data);
    await db().runTransaction(async (tx) => {
      const r = await getReferral(input.referralId, tx);
      if (!r) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      assertReferralWorker(ctx, r.clinicId);
      const check = canTransition(r.type, r.status, 'CANCELLED', 'midwife');
      if (!check.allowed) throw maraError('failed-precondition', 'INVALID_TRANSITION', check.reason ?? 'This referral cannot be cancelled.');
      const tokens = await readActiveTokens(tx, r.referralId);
      const now = Timestamp.now();
      tx.update(referralRef(r.referralId), {
        status: 'CANCELLED',
        statusHistory: [...r.statusHistory, { status: 'CANCELLED', at: now, actor: 'midwife', uid: ctx.uid, note: null }],
        cancelReason: input.reason,
        cancelledAt: now,
        updatedAt: now,
        'link.revoked': true,
      });
      revokeTokensInTx(tx, tokens, now);
      auditInTx(tx, { action: 'referral_cancelled', actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId: r.clinicId, patientId: r.patientId, referralId: r.referralId, details: { from: r.status, tokensRevoked: tokens.length } });
    });
    return { status: 'CANCELLED' };
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const revokeReferralLink = onCall<RevokeReferralLinkRequest>(callableOptions(), async (request): Promise<RevokeReferralLinkResponse> => {
  try {
    const ctx = await requireStaff(request);
    const { referralId } = parseInput(idSchema, request.data);
    await db().runTransaction(async (tx) => {
      const r = await getReferral(referralId, tx);
      if (!r) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      assertReferralWorker(ctx, r.clinicId);
      const tokens = await readActiveTokens(tx, r.referralId);
      const now = Timestamp.now();
      tx.update(referralRef(r.referralId), { 'link.revoked': true, updatedAt: now });
      revokeTokensInTx(tx, tokens, now);
      auditInTx(tx, { action: 'referral_link_revoked', actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId: r.clinicId, patientId: r.patientId, referralId: r.referralId, details: { tokensRevoked: tokens.length } });
    });
    return { revoked: true };
  } catch (err) {
    throw toHttpsError(err);
  }
});

const RESENDABLE: ReferralStatus[] = ['SENT', 'ACKNOWLEDGED'];

/** Rotates the token: all active tokens revoked, a new one issued. Never creates a new referral doc. */
export const resendReferralLink = onCall<ResendReferralLinkRequest>(callableOptions({ sms: true }), async (request): Promise<ResendReferralLinkResponse> => {
  try {
    const ctx = await requireStaff(request);
    const input = parseInput(z.object({ referralId: z.string().trim().min(1).max(64), smsHospital: z.boolean().default(false) }), request.data);
    const { link, referral } = await db().runTransaction(async (tx) => {
      const r = await getReferral(input.referralId, tx);
      if (!r) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
      assertReferralWorker(ctx, r.clinicId);
      if (!RESENDABLE.includes(r.status)) throw maraError('failed-precondition', 'INVALID_TRANSITION', 'The link can only be resent for sent or acknowledged referrals.');
      const tokens = await readActiveTokens(tx, r.referralId);
      const nowMs = Date.now();
      const now = Timestamp.fromMillis(nowMs);
      const issued: IssuedLink = issueLink(nowMs);
      revokeTokensInTx(tx, tokens, now);
      createTokenInTx(tx, r.referralId, r.clinicId, issued, nowMs);
      const issueCount = (r.link?.issueCount ?? 0) + 1;
      tx.update(referralRef(r.referralId), {
        link: { expiresAt: Timestamp.fromMillis(issued.expiresAtMillis), revoked: false, issuedAt: now, issueCount },
        updatedAt: now,
      });
      auditInTx(tx, { action: 'referral_link_resent', actorKind: 'user', actorUid: ctx.uid, actorRole: ctx.role, clinicId: r.clinicId, patientId: r.patientId, referralId: r.referralId, details: { issueCount, tokensRevoked: tokens.length, smsHospital: input.smsHospital } });
      return { link: issued, referral: r };
    });
    if (input.smsHospital) {
      const mobile = sms.normalizePhMobile(referral.hospital.phone);
      if (mobile) {
        await sendSms({ recipient: mobile, recipientRole: 'hospital', messageType: 'hospital_referral_link', referralId: referral.referralId, clinicId: referral.clinicId, message: sms.hospitalReferralLink(referral.referralId, referral.clinic.name, link.url, referral.type === 'emergency') });
      }
    }
    return { link: linkResult(link) };
  } catch (err) {
    throw toHttpsError(err);
  }
});

const LINK_MESSAGE_TYPES = new Set(['hospital_referral_link', 'midwife_referral_link']);

export const resendSms = onCall<ResendSmsRequest>(callableOptions({ sms: true }), async (request): Promise<ResendSmsResponse> => {
  try {
    const ctx = await requireStaff(request);
    const { smsLogId } = parseInput(z.object({ smsLogId: z.string().trim().min(1).max(128) }), request.data);
    const log = await getSmsLog(smsLogId);
    if (!log) throw maraError('not-found', 'NOT_FOUND', MESSAGES.notFound);
    assertClinicAccess(ctx, log.clinicId);
    if (ctx.role === 'super_admin') throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
    // Stored link SMS bodies are redacted (raw tokens are never stored) → a new link must be issued instead.
    if (LINK_MESSAGE_TYPES.has(log.messageType)) {
      throw maraError('failed-precondition', 'VALIDATION', 'Link messages cannot be resent as-is. Use "Resend link" to issue a new hospital link.');
    }
    const status = await resendSmsLog(smsLogId, { uid: ctx.uid, role: ctx.role });
    return { status };
  } catch (err) {
    throw toHttpsError(err, 'Unable to resend the SMS. Please try again.');
  }
});
