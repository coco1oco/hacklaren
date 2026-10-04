/**
 * Host-agnostic HTTP entry for MARA's server API (used on Vercel, where Cloud Functions are unavailable on the
 * Firebase Spark plan). Each callable keeps exactly the same code path as on Cloud Functions: we verify the caller the
 * way the Functions runtime does (Firebase ID token, optional App Check), then invoke the callable's own handler via
 * firebase-functions' `run()` hook. Errors use the same { error: { status, message, details } } shape.
 *
 *   POST /api/call/<name>   body: { "data": ... }   header: Authorization: Bearer <Firebase ID token> (optional)
 *   GET  /api/cron/cleanup  header: Authorization: Bearer <CRON_SECRET>
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { CALLABLES, type CreateReferralResponse, type ProcessReferralRequestResponse } from '../shared/contracts';
import { adminAppCheck, adminAuth } from '../lib/firebase';
import { MESSAGES } from '../lib/errors';
import { runSummary } from '../services/summary/runSummary';
import { runCleanup } from '../scheduled/cleanup';
import { createReferral } from '../referrals/createReferral';
import { generateSummary, sendReferral } from '../referrals/summaryAndSend';
import { getReferralView, updateReferralStatus } from '../referrals/hospital';
import { cancelReferral, resendReferralLink, resendSms, revokeReferralLink } from '../referrals/manage';
import { generateReferralPdf } from '../pdf/generateReferralPdf';
import { createStaffUser, setStaffActive } from '../admin/staff';
import { registerClinic } from '../admin/onboarding';
import { getReferralReport } from '../admin/report';
import { processReferralRequestCallable } from '../referrals/triggers';

type Runnable = { run(request: CallableRequest<unknown>): unknown };

const REGISTRY: Record<string, Runnable> = {
  [CALLABLES.createReferral]: createReferral,
  [CALLABLES.generateSummary]: generateSummary,
  [CALLABLES.sendReferral]: sendReferral,
  [CALLABLES.getReferralView]: getReferralView,
  [CALLABLES.updateReferralStatus]: updateReferralStatus,
  [CALLABLES.cancelReferral]: cancelReferral,
  [CALLABLES.revokeReferralLink]: revokeReferralLink,
  [CALLABLES.resendReferralLink]: resendReferralLink,
  [CALLABLES.resendSms]: resendSms,
  [CALLABLES.generateReferralPdf]: generateReferralPdf,
  [CALLABLES.createStaffUser]: createStaffUser,
  [CALLABLES.setStaffActive]: setStaffActive,
  [CALLABLES.getReferralReport]: getReferralReport,
  [CALLABLES.registerClinic]: registerClinic,
  [CALLABLES.processReferralRequest]: processReferralRequestCallable,
} as unknown as Record<string, Runnable>;

export const CALLABLE_NAMES = Object.keys(REGISTRY);

const MAX_BODY_BYTES = 1_000_000;

export interface HostHooks {
  /** Keeps background work (emergency AI summary) alive after the response is sent. Vercel: @vercel/functions waitUntil. */
  waitUntil?: (p: Promise<unknown>) => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

const HTTP_STATUS: Record<string, number> = {
  'invalid-argument': 400,
  'failed-precondition': 400,
  'out-of-range': 400,
  unauthenticated: 401,
  'permission-denied': 403,
  'not-found': 404,
  'already-exists': 409,
  aborted: 409,
  'resource-exhausted': 429,
  cancelled: 499,
  unimplemented: 501,
  unavailable: 503,
  'deadline-exceeded': 504,
};

function errorResponse(err: HttpsError): Response {
  return json(HTTP_STATUS[err.code] ?? 500, { error: { status: err.code, message: err.message, details: err.details ?? null } });
}

/** Lower-cased header map. The client IP comes from the host's own header (Vercel sets x-real-ip; not client-controlled). */
function rawRequestFrom(req: Request): { ip: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const ip = headers['x-real-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  // Downstream rate limiting reads x-forwarded-for's first hop: pin it to the trusted IP.
  headers['x-forwarded-for'] = ip;
  return { ip, headers };
}

async function verifyCaller(req: Request): Promise<CallableRequest<unknown>['auth']> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return undefined;
  try {
    // checkRevoked: deactivated staff (setStaffActive revokes refresh tokens) are rejected immediately.
    const token = await adminAuth().verifyIdToken(match[1], true);
    return { uid: token.uid, token, rawToken: match[1] } as CallableRequest<unknown>['auth'];
  } catch {
    throw new HttpsError('unauthenticated', 'Your session has ended. Please sign in again.');
  }
}

async function verifyAppCheck(req: Request): Promise<void> {
  if (process.env.ENFORCE_APP_CHECK !== 'true') return;
  const token = req.headers.get('x-firebase-appcheck');
  if (!token) throw new HttpsError('unauthenticated', 'This app could not be verified. Please reload and try again.');
  try {
    await adminAppCheck().verifyToken(token);
  } catch {
    throw new HttpsError('unauthenticated', 'This app could not be verified. Please reload and try again.');
  }
}

/** Emergency summaries run AFTER the response (replaces the onReferralCreated Firestore trigger). Never awaited. */
function scheduleSummary(referralId: string, hooks: HostHooks): void {
  const job = runSummary(referralId).catch((err: unknown) => {
    logger.error('Background summary failed', { referralId, message: err instanceof Error ? err.message : String(err) });
  });
  hooks.waitUntil?.(job);
}

export async function handleCallable(name: string, req: Request, hooks: HostHooks = {}): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: { status: 'invalid-argument', message: 'Use POST.', details: null } });
  const fn = Object.prototype.hasOwnProperty.call(REGISTRY, name) ? REGISTRY[name] : undefined;
  if (!fn) return json(404, { error: { status: 'not-found', message: 'Unknown function.', details: null } });
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) throw new HttpsError('invalid-argument', 'Request is too large.');
    let body: { data?: unknown };
    try {
      body = text ? (JSON.parse(text) as { data?: unknown }) : {};
    } catch {
      throw new HttpsError('invalid-argument', 'Request body must be JSON.');
    }
    await verifyAppCheck(req);
    const auth = await verifyCaller(req);
    const request = { data: body?.data ?? null, auth, rawRequest: rawRequestFrom(req), acceptsStreaming: false } as unknown as CallableRequest<unknown>;
    const result = await fn.run(request);

    if (name === CALLABLES.createReferral) {
      const r = result as CreateReferralResponse;
      if (r?.status === 'SENT' && r.link && !r.deduplicated) scheduleSummary(r.referralId, hooks);
    } else if (name === CALLABLES.processReferralRequest) {
      const r = result as ProcessReferralRequestResponse;
      if (r?.state === 'processed' && r.referralId) scheduleSummary(r.referralId, hooks);
    }
    return json(200, { result: result ?? null });
  } catch (err) {
    if (err instanceof HttpsError) return errorResponse(err);
    logger.error('Unhandled API error', { name, message: err instanceof Error ? err.message : String(err) });
    return errorResponse(new HttpsError('internal', MESSAGES.generic));
  }
}

/** Daily maintenance (Vercel Cron). Requires Authorization: Bearer <CRON_SECRET>. */
export async function handleCron(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json(401, { error: 'unauthorized' });
  const results = await runCleanup();
  return json(200, { ok: true, results });
}
