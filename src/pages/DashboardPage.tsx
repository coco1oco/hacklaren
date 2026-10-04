import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ACTIVE_STATUSES, STATUS_LABELS } from '@shared/referralStatus';
import { daysUntil, isDueSoon } from '@shared/pregnancy';
import { useClinicData } from '@/data/ClinicDataProvider';
import { useAuth } from '@/auth/AuthProvider';
import { pregnancyStatus } from '@/lib/pregnancyView';
import { formatDate, formatDateTime, millis } from '@/lib/format';
import { Alert, Badge, ButtonLink, Card, Loading, PageHeader } from '@/components/ui';
import { FailedReferralsPanel, QueuedReferralsPanel, SyncConflictsPanel, SyncIndicator } from '@/components/SyncStatus';
import { StatusStepper } from '@/components/StatusStepper';

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <dt className="text-sm font-semibold text-slate-700">
        {label}
        {sub && <span className="block font-normal">{sub}</span>}
      </dt>
      <dd className="text-3xl font-extrabold text-slate-900 tabular-nums">{value}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const { patients, patientsLoading, patientsError, referrals, clinic } = useClinicData();
  const { staff } = useAuth();

  const stats = useMemo(() => {
    const active = patients.filter((p) => p.active);
    const now = new Date();
    const tri = { 1: 0, 2: 0, 3: 0 };
    for (const p of active) {
      const t = pregnancyStatus(p.pregnancy?.lmp, now).trimester;
      if (t) tri[t] += 1;
    }
    const dueSoon = active
      .filter((p) => p.pregnancy?.edd && isDueSoon(p.pregnancy.edd, now))
      .sort((a, b) => a.pregnancy.edd.localeCompare(b.pregnancy.edd));
    return { active: active.length, tri, dueSoon };
  }, [patients]);

  const activeReferrals = useMemo(
    () => referrals.filter((r) => ACTIVE_STATUSES.includes(r.status)).sort((a, b) => (millis(b.createdAt) ?? 0) - (millis(a.createdAt) ?? 0)),
    [referrals],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle={[clinic?.name, staff?.name].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <ButtonLink to="/patients/new">Add Patient</ButtonLink>
            <ButtonLink to="/patients" variant="secondary">
              Search Patient
            </ButtonLink>
          </>
        }
      />
      <FailedReferralsPanel />
      <SyncIndicator />
      <SyncConflictsPanel />
      <QueuedReferralsPanel />

      {patientsError && <Alert tone="error">Could not load patients. Check your connection and try again.</Alert>}
      {patientsLoading ? (
        <Loading label="Loading clinic data…" />
      ) : (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Active Patients" value={stats.active} />
          <Stat label="1st Trimester" value={stats.tri[1]} />
          <Stat label="2nd Trimester" value={stats.tri[2]} />
          <Stat label="3rd Trimester" value={stats.tri[3]} />
          <Stat label="Due Soon" sub="EDD within 4 weeks" value={stats.dueSoon.length} />
        </dl>
      )}

      <Card title={`Active Referrals (${activeReferrals.length})`} actions={<Link to="/referrals" className="inline-flex min-h-12 items-center font-semibold text-brand-800 underline">All referrals</Link>}>
        {activeReferrals.length === 0 ? (
          <p className="text-slate-700">No active referrals.</p>
        ) : (
          <ul className="space-y-3">
            {activeReferrals.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/referrals/${r.id}`} className="font-bold text-brand-800 underline">
                    {r.patientName}
                  </Link>
                  <Badge tone={r.type === 'emergency' ? 'error' : 'info'}>{r.type === 'emergency' ? 'Emergency' : 'Checkup'}</Badge>
                  <span className="text-sm text-slate-700">
                    → {r.hospital?.name} · {STATUS_LABELS[r.status]} · {formatDateTime(millis(r.createdAt))}
                  </span>
                </div>
                <div className="mt-2">
                  <StatusStepper type={r.type} status={r.status} history={(r.statusHistory ?? []).map((h) => h.status)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Due Soon">
        <p className="mb-2 text-sm text-slate-700">Informational list of patients whose EDD is within the next 4 weeks.</p>
        {stats.dueSoon.length === 0 ? (
          <p className="text-slate-700">No patients due in the next 4 weeks.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {stats.dueSoon.map((p) => {
              const days = daysUntil(p.pregnancy.edd);
              return (
                <li key={p.id}>
                  <Link to={`/patients/${p.patientId}`} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-2 hover:bg-slate-50">
                    <span className="font-semibold text-brand-800 underline">{p.name}</span>
                    <span className="text-sm text-slate-700">
                      EDD {formatDate(p.pregnancy.edd)} ({days === 0 ? 'today' : `in ${days} days`}) · {pregnancyStatus(p.pregnancy.lmp).gaLabel}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
