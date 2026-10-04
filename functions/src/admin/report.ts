import { FieldPath, Timestamp, type Query } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { z } from 'zod';
import { COLLECTIONS, type ClinicDoc, type GetReferralReportRequest, type GetReferralReportResponse } from '../shared/contracts';
import { requireRole, requireStaff } from '../lib/auth';
import { db } from '../lib/firebase';
import { parseInput, toHttpsError } from '../lib/errors';
import { callableOptions } from '../lib/options';
import { aggregateReferralReport, type ReportReferral } from '../services/report';

const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 366 * DAY_MS;
const PAGE = 1000;
/** Hard cap on documents scanned per report (bounds cost/latency). */
const MAX_DOCS = 50_000;

export const reportRequestSchema = z
  .object({
    fromMillis: z.number().int().min(0),
    toMillis: z.number().int().min(0),
    clinicId: z.string().trim().min(1).max(64).nullable(),
    type: z.enum(['emergency', 'checkup']).nullable(),
    status: z.enum(['CREATED', 'SENT', 'ACKNOWLEDGED', 'ARRIVED', 'DECLINED', 'EXPIRED', 'CANCELLED']).nullable(),
  })
  .strict()
  .refine((v) => v.fromMillis <= v.toMillis, { message: 'The start date must be on or before the end date.' })
  .refine((v) => v.toMillis - v.fromMillis <= MAX_RANGE_MS, { message: 'The report range cannot exceed 366 days.' });

/**
 * Counts-only referral report. clinic_admin: own clinic (requested clinicId ignored). super_admin: any/all clinics.
 * Uses a field mask so no patient/clinical fields are ever read into memory.
 */
export const getReferralReport = onCall<GetReferralReportRequest>(callableOptions({ timeoutSeconds: 120 }), async (request): Promise<GetReferralReportResponse> => {
  try {
    const ctx = await requireStaff(request);
    requireRole(ctx, ['clinic_admin', 'super_admin']);
    const input = parseInput(reportRequestSchema, request.data);
    const clinicId = ctx.role === 'clinic_admin' ? ctx.clinicId : input.clinicId;

    // createdAt range (+ clinicId equality → composite index clinicId ASC, createdAt ASC). type/status filtered in memory.
    let base: Query = db().collection(COLLECTIONS.referrals);
    if (clinicId) base = base.where('clinicId', '==', clinicId);
    base = base
      .where('createdAt', '>=', Timestamp.fromMillis(input.fromMillis))
      .where('createdAt', '<=', Timestamp.fromMillis(input.toMillis))
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .select('clinicId', 'type', 'status', 'statusHistory');

    const referrals: ReportReferral[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (;;) {
      const page: FirebaseFirestore.QuerySnapshot = await (cursor ? base.startAfter(cursor) : base).limit(PAGE).get();
      for (const d of page.docs) {
        const data = d.data();
        referrals.push({
          clinicId: String(data.clinicId ?? ''),
          type: data.type,
          status: data.status,
          statusHistory: Array.isArray(data.statusHistory) ? data.statusHistory.map((h: { status?: unknown }) => ({ status: h?.status as ReportReferral['status'] })) : [],
        });
      }
      if (page.size < PAGE) break;
      if (referrals.length >= MAX_DOCS) {
        logger.warn('getReferralReport: document cap reached; report truncated', { cap: MAX_DOCS });
        break;
      }
      cursor = page.docs[page.docs.length - 1] ?? null;
    }

    const clinicIds = [...new Set(referrals.map((r) => r.clinicId).filter(Boolean))];
    const clinicNames = new Map<string, string>();
    if (clinicIds.length) {
      const snaps = await db().getAll(...clinicIds.map((id) => db().collection(COLLECTIONS.clinics).doc(id)));
      for (const s of snaps) if (s.exists) clinicNames.set(s.id, (s.data() as ClinicDoc).name);
    }

    return aggregateReferralReport(referrals, clinicNames, { type: input.type, status: input.status });
  } catch (err) {
    throw toHttpsError(err, 'Unable to load the report. Please try again.');
  }
});
