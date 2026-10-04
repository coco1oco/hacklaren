import { useEffect, useMemo, useState } from 'react';
import type { GetReferralReportRequest, GetReferralReportResponse, ReferralReportCounts } from '@shared/contracts';
import { STATUS_LABELS } from '@shared/referralStatus';
import { parseIsoDate } from '@shared/pregnancy';
import type { ReferralStatus, ReferralType } from '@shared/types';
import { useAuth } from '@/auth/AuthProvider';
import { useAllClinics } from '@/data/hospitals';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Alert, Card, Loading, PageHeader, SelectField, TextField } from '@/components/ui';

const STATUSES = Object.keys(STATUS_LABELS) as ReferralStatus[];
const DAY_MS = 86_400_000;

function dayStart(iso: string): number | null {
  if (parseIsoDate(iso) === null) return null;
  const [y, m, day] = iso.split('-').map(Number);
  return new Date(y, m - 1, day).getTime();
}

const METRICS: { key: keyof ReferralReportCounts; label: string }[] = [
  { key: 'sent', label: 'Referrals sent' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'declined', label: 'Declined' },
  { key: 'arrived', label: 'Patients arrived' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'expired', label: 'Expired' },
];

/**
 * Referral counts from the getReferralReport callable (counts only, computed server-side).
 * Neither role reads referral documents here; clinic_admin is limited to their own clinic by the server.
 */
export default function AdminReportsPage() {
  const { claims } = useAuth();
  const isSuper = claims?.role === 'super_admin';
  const clinics = useAllClinics(isSuper);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [type, setType] = useState<'' | ReferralType>('');
  const [status, setStatus] = useState<'' | ReferralStatus>('');

  const range = useMemo(() => {
    const fromMs = from ? dayStart(from) : 0;
    const toStart = to ? dayStart(to) : null;
    const toMs = to ? (toStart === null ? null : toStart + DAY_MS) : null;
    if (fromMs === null || (to && toMs === null)) return { error: 'Enter valid dates.' } as const;
    if (toMs !== null && toMs <= fromMs) return { error: '"To date" must be on or after "From date".' } as const;
    return { fromMs, toMs } as const;
  }, [from, to]);

  const [report, setReport] = useState<GetReferralReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if ('error' in range) return undefined;
    let cancelled = false;
    const req: GetReferralReportRequest = {
      fromMillis: range.fromMs,
      toMillis: range.toMs ?? Date.now() + 60_000,
      clinicId: isSuper ? clinicId || null : (claims?.clinicId ?? null),
      type: type || null,
      status: status || null,
    };
    setLoading(true);
    setError(null);
    api
      .getReferralReport(req)
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(userMessage(err, 'Could not load the report. Check your connection and try again.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, isSuper, clinicId, claims?.clinicId, type, status]);

  const clinicName = (id: string, fallback: string) => clinics.data.find((c) => c.id === id)?.name ?? fallback ?? id;

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle={isSuper ? 'All clinics' : 'Your clinic'} />
      <Card title="Filters">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {isSuper && (
            <SelectField label="Clinic" value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
              <option value="">All clinics</option>
              {clinics.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as '' | ReferralType)}>
            <option value="">All types</option>
            <option value="emergency">Emergency</option>
            <option value="checkup">Checkup</option>
          </SelectField>
          <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | ReferralStatus)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </SelectField>
        </div>
        {'error' in range && <p className="mt-2 font-semibold text-red-800">{range.error}</p>}
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {loading && !report ? (
        <Loading label="Loading report…" />
      ) : report ? (
        <div aria-busy={loading} className="space-y-4">
          <p aria-live="polite" className="font-semibold">
            {report.totals.total} {report.totals.total === 1 ? 'referral' : 'referrals'} match the filters.
          </p>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {METRICS.map((m) => (
              <div key={m.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <dt className="text-sm font-semibold text-slate-700">{m.label}</dt>
                <dd className="text-3xl font-extrabold tabular-nums">{report.totals[m.key]}</dd>
              </div>
            ))}
          </dl>
          <Card title={isSuper ? 'By clinic and type' : 'By type'}>
            {report.rows.length === 0 ? (
              <p className="text-slate-700">No referrals.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      {isSuper && <th scope="col">Clinic</th>}
                      <th scope="col">Type</th>
                      <th scope="col" className="text-right">
                        Total
                      </th>
                      {METRICS.map((m) => (
                        <th key={m.key} scope="col" className="text-right">
                          {m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r) => (
                      <tr key={`${r.clinicId}-${r.type}`} className="border-t border-slate-200">
                        {isSuper && <td className="py-1">{clinicName(r.clinicId, r.clinicName)}</td>}
                        <td className="py-1">{r.type === 'emergency' ? 'Emergency' : 'Checkup'}</td>
                        <td className="py-1 text-right tabular-nums">{r.total}</td>
                        {METRICS.map((m) => (
                          <td key={m.key} className="py-1 text-right tabular-nums">
                            {r[m.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <p className="text-sm text-slate-700">
            Counts are calculated on the server; only totals are returned to this page. “Sent” and “Acknowledged” count referrals that ever reached that step.
          </p>
        </div>
      ) : null}
    </div>
  );
}
