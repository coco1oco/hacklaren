import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { filterForStatus, type ReferralFilter } from '@shared/referralStatus';
import { useClinicData } from '@/data/ClinicDataProvider';
import { formatDateTime, millis } from '@/lib/format';
import { Alert, Badge, Loading, PageHeader } from '@/components/ui';
import { StatusStepper } from '@/components/StatusStepper';
import { TypeBadge } from '@/components/referral/ReferralBits';
import { FailedReferralsPanel } from '@/components/SyncStatus';

const TABS: { key: ReferralFilter; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'declined', label: 'Declined' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'expired', label: 'Expired' },
];

export default function ReferralsListPage() {
  const { referrals, referralsLoading, queued, clinicId } = useClinicData();
  const [tab, setTab] = useState<ReferralFilter>('active');

  const counts = useMemo(() => {
    const c: Record<ReferralFilter, number> = { active: 0, completed: 0, declined: 0, cancelled: 0, expired: 0 };
    for (const r of referrals) c[filterForStatus(r.status)]++;
    return c;
  }, [referrals]);

  const shown = useMemo(
    () => referrals.filter((r) => filterForStatus(r.status) === tab).sort((a, b) => (millis(b.createdAt) ?? 0) - (millis(a.createdAt) ?? 0)),
    [referrals, tab],
  );

  if (!clinicId) return <Alert tone="error" title="Clinic staff only">Referrals belong to a clinic. Your account is not assigned to a clinic.</Alert>;

  return (
    <div>
      <PageHeader title="Referrals" subtitle="Updates in real time." />

      <div className="mb-4">
        <FailedReferralsPanel />
      </div>

      {queued.length > 0 && (
        <Alert tone="warning" title={`${queued.length} emergency referral(s) waiting for connection`} className="mb-4">
          <ul className="ml-5 list-disc">
            {queued.map((q) => (
              <li key={q.clientRequestId}>
                {q.patientName} → {q.hospitalName} ({q.reasonLabel}). Not yet received by the hospital. Call the hospital: {q.hospitalPhone}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div role="group" aria-label="Filter referrals" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-12 rounded-lg border-2 px-4 font-semibold ${tab === t.key ? 'border-brand-800 bg-brand-800 text-white' : 'border-slate-400 bg-white text-slate-900 hover:bg-slate-100'}`}
          >
            {t.label} <span className="tabular-nums">({counts[t.key]})</span>
          </button>
        ))}
      </div>

      {referralsLoading && !referrals.length ? (
        <Loading label="Loading referrals…" />
      ) : shown.length === 0 ? (
        <p className="text-slate-800">No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} referrals.</p>
      ) : (
        <ul className="grid gap-3">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                to={`/referrals/${r.referralId}`}
                className={`block rounded-xl border-2 bg-white p-4 shadow-sm hover:bg-slate-50 ${r.type === 'emergency' ? 'border-red-700' : 'border-slate-200'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold text-slate-900">{r.patientName}</span>
                  <TypeBadge type={r.type} />
                  {r._pending && <Badge tone="warning">Syncing</Badge>}
                </div>
                <p className="mt-1 text-slate-800">To {r.hospital.name}</p>
                <div className="mt-2">
                  <StatusStepper type={r.type} status={r.status} history={r.statusHistory.map((h) => h.status)} />
                </div>
                <p className="mt-1 text-sm text-slate-700">Created {formatDateTime(millis(r.createdAt))}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
