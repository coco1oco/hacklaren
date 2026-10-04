import { onCall } from 'firebase-functions/v2/https';
import type { CreateReferralRequest, CreateReferralResponse } from '../shared/contracts';
import { checkupReferralInputSchema, emergencyReferralInputSchema } from '../shared/schemas';
import { assertReferralWorker, requireStaff } from '../lib/auth';
import { MESSAGES, maraError, parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { linkResult } from '../services/links';
import { createCheckupReferral, createEmergencyReferral, notifyEmergency } from './core';

export const createReferral = onCall<CreateReferralRequest>(callableOptions({ sms: true }), async (request): Promise<CreateReferralResponse> => {
  try {
    const ctx = await requireStaff(request);
    const data = (request.data ?? {}) as Partial<CreateReferralRequest> & Record<string, unknown>;
    if (!ctx.clinicId) throw maraError('permission-denied', 'FORBIDDEN', MESSAGES.forbidden);
    assertReferralWorker(ctx, ctx.clinicId);
    const actor = { uid: ctx.uid, role: ctx.role, staff: ctx.staff };

    if (data.type === 'emergency') {
      const { type: _type, ...rest } = data;
      const input = parseInput(emergencyReferralInputSchema, rest);
      const { result, doc, loaded } = await createEmergencyReferral(actor, input, { source: 'callable' });
      // Link is already issued and committed. SMS failures are logged and never fail the request.
      if (doc && loaded && result.link) await notifyEmergency(doc, loaded, result.link);
      return { referralId: result.referralId, status: result.status, link: result.link ? linkResult(result.link) : null, deduplicated: result.deduplicated };
    }
    if (data.type === 'checkup') {
      const { type: _type, ...rest } = data;
      const input = parseInput(checkupReferralInputSchema, rest);
      const result = await createCheckupReferral(actor, input);
      return { referralId: result.referralId, status: result.status, link: null, deduplicated: result.deduplicated };
    }
    throw maraError('invalid-argument', 'VALIDATION', 'Choose a referral type.');
  } catch (err) {
    throw toHttpsError(err, MESSAGES.sendFailed);
  }
});
