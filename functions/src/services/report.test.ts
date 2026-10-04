import { describe, expect, it } from 'vitest';
import type { ReferralStatus, ReferralType } from '../shared/types';
import { aggregateReferralReport, emptyCounts, type ReportReferral } from './report';

const r = (clinicId: string, type: ReferralType, history: ReferralStatus[]): ReportReferral => ({
  clinicId,
  type,
  status: history[history.length - 1]!,
  statusHistory: history.map((status) => ({ status })),
});

const names = new Map([
  ['c1', 'Alpha Clinic'],
  ['c2', 'Beta Clinic'],
]);

describe('aggregateReferralReport', () => {
  it('returns empty rows and zero totals for no referrals', () => {
    expect(aggregateReferralReport([], names)).toEqual({ rows: [], totals: emptyCounts() });
  });

  it('groups by (clinicId, type) and counts statuses ever reached', () => {
    const res = aggregateReferralReport(
      [
        r('c1', 'emergency', ['SENT', 'ACKNOWLEDGED', 'ARRIVED']),
        r('c1', 'emergency', ['SENT', 'DECLINED']),
        r('c1', 'checkup', ['CREATED']),
        r('c1', 'checkup', ['CREATED', 'SENT', 'EXPIRED']),
        r('c2', 'checkup', ['CREATED', 'CANCELLED']),
      ],
      names,
    );
    expect(res.rows).toEqual([
      { clinicId: 'c1', clinicName: 'Alpha Clinic', type: 'checkup', total: 2, sent: 1, acknowledged: 0, declined: 0, arrived: 0, cancelled: 0, expired: 1 },
      { clinicId: 'c1', clinicName: 'Alpha Clinic', type: 'emergency', total: 2, sent: 2, acknowledged: 1, declined: 1, arrived: 1, cancelled: 0, expired: 0 },
      { clinicId: 'c2', clinicName: 'Beta Clinic', type: 'checkup', total: 1, sent: 0, acknowledged: 0, declined: 0, arrived: 0, cancelled: 1, expired: 0 },
    ]);
    expect(res.totals).toEqual({ total: 5, sent: 3, acknowledged: 1, declined: 1, arrived: 1, cancelled: 1, expired: 1 });
  });

  it('totals equal the sum of rows', () => {
    const res = aggregateReferralReport(
      [r('c1', 'emergency', ['SENT']), r('c2', 'emergency', ['SENT', 'ACKNOWLEDGED']), r('c2', 'checkup', ['CREATED'])],
      names,
    );
    const summed = res.rows.reduce((acc, row) => {
      (Object.keys(acc) as (keyof typeof acc)[]).forEach((k) => (acc[k] += row[k]));
      return acc;
    }, emptyCounts());
    expect(res.totals).toEqual(summed);
  });

  it('filters by type and by CURRENT status', () => {
    const data = [r('c1', 'emergency', ['SENT', 'ACKNOWLEDGED']), r('c1', 'emergency', ['SENT']), r('c1', 'checkup', ['CREATED', 'SENT'])];
    const byType = aggregateReferralReport(data, names, { type: 'checkup', status: null });
    expect(byType.totals.total).toBe(1);
    expect(byType.rows.map((x) => x.type)).toEqual(['checkup']);

    // status=SENT matches current status only: the ACKNOWLEDGED referral (which passed through SENT) is excluded.
    const bySent = aggregateReferralReport(data, names, { type: null, status: 'SENT' });
    expect(bySent.totals.total).toBe(2);
    expect(bySent.totals.acknowledged).toBe(0);
  });

  it('counts the current status even when statusHistory is missing it', () => {
    const res = aggregateReferralReport([{ clinicId: 'c1', type: 'emergency', status: 'SENT', statusHistory: [] }], names);
    expect(res.totals.sent).toBe(1);
  });

  it('uses a placeholder name for unknown clinics and accepts a plain record of names', () => {
    const res = aggregateReferralReport([r('cX', 'emergency', ['SENT'])], { c1: 'Alpha Clinic' });
    expect(res.rows[0]!.clinicName).toBe('Unknown clinic');
  });

  it('never exposes fields other than ids, names, type and counts', () => {
    const res = aggregateReferralReport([r('c1', 'emergency', ['SENT'])], names);
    expect(Object.keys(res.rows[0]!).sort()).toEqual(
      ['acknowledged', 'arrived', 'cancelled', 'clinicId', 'clinicName', 'declined', 'expired', 'sent', 'total', 'type'].sort(),
    );
  });
});
