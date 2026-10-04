// Referral reporting: counts only. Never returns patient names, reasons, summaries, or any clinical data.
import type { GetReferralReportResponse, ReferralReportCounts, ReferralReportRow } from '../shared/contracts';
import type { ReferralStatus, ReferralType } from '../shared/types';

/** The only referral fields the report reads (fetched with a Firestore field mask). */
export interface ReportReferral {
  clinicId: string;
  type: ReferralType;
  status: ReferralStatus;
  statusHistory: { status: ReferralStatus }[];
}

export interface ReportFilters {
  type: ReferralType | null;
  /** Current status must equal this value. */
  status: ReferralStatus | null;
}

export const emptyCounts = (): ReferralReportCounts => ({ total: 0, sent: 0, acknowledged: 0, declined: 0, arrived: 0, cancelled: 0, expired: 0 });

const EVER_COUNTERS: [keyof Omit<ReferralReportCounts, 'total'>, ReferralStatus][] = [
  ['sent', 'SENT'],
  ['acknowledged', 'ACKNOWLEDGED'],
  ['declined', 'DECLINED'],
  ['arrived', 'ARRIVED'],
  ['cancelled', 'CANCELLED'],
  ['expired', 'EXPIRED'],
];

function addTo(counts: ReferralReportCounts, r: ReportReferral): void {
  counts.total += 1;
  const reached = new Set<ReferralStatus>((Array.isArray(r.statusHistory) ? r.statusHistory : []).map((h) => h?.status));
  // The current status always counts as reached, even if history is incomplete.
  reached.add(r.status);
  for (const [key, status] of EVER_COUNTERS) if (reached.has(status)) counts[key] += 1;
}

/**
 * Pure aggregation of referrals into per-(clinicId, type) rows + totals.
 * `sent`/`acknowledged`/... = referral EVER reached that status (statusHistory); the `status` filter matches the CURRENT status.
 * Rows are sorted by clinic name, then clinicId, then type.
 */
export function aggregateReferralReport(
  referrals: Iterable<ReportReferral>,
  clinicNames: ReadonlyMap<string, string> | Record<string, string>,
  filters: ReportFilters = { type: null, status: null },
): GetReferralReportResponse {
  const nameOf = (id: string): string => {
    const name = clinicNames instanceof Map ? clinicNames.get(id) : (clinicNames as Record<string, string>)[id];
    return name ?? 'Unknown clinic';
  };
  const rows = new Map<string, ReferralReportRow>();
  const totals = emptyCounts();
  for (const r of referrals) {
    if (filters.type && r.type !== filters.type) continue;
    if (filters.status && r.status !== filters.status) continue;
    const key = `${r.clinicId}\u0000${r.type}`;
    let row = rows.get(key);
    if (!row) {
      row = { clinicId: r.clinicId, clinicName: nameOf(r.clinicId), type: r.type, ...emptyCounts() };
      rows.set(key, row);
    }
    addTo(row, r);
    addTo(totals, r);
  }
  const sorted = [...rows.values()].sort(
    (a, b) => a.clinicName.localeCompare(b.clinicName) || a.clinicId.localeCompare(b.clinicId) || a.type.localeCompare(b.type),
  );
  return { rows: sorted, totals };
}
