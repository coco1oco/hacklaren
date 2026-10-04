import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { abnormalTrends, currentMedications, sortVisitsAsc, visitRiskFlags } from '@shared/riskFlags';
import { STATUS_LABELS } from '@shared/referralStatus';
import { ageInYears } from '@shared/pregnancy';
import { DANGER_SIGN_LABELS, type DangerSigns } from '@shared/types';
import { useCtx } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { api } from '@/lib/api';
import { logAudit } from '@/lib/audit';
import { downloadBase64Pdf } from '@/lib/download';
import { userMessage } from '@/lib/errors';
import { describeGravidaPara, formatDate, formatDateTime, millis, URINE_LABELS } from '@/lib/format';
import { pregnancyStatus } from '@/lib/pregnancyView';
import { useOnline } from '@/lib/useOnline';
import { Alert, Badge, Button, ButtonLink, Card, Loading, PageHeader } from '@/components/ui';
import { StatusStepper } from '@/components/StatusStepper';
import { FailedReferralsPanel } from '@/components/SyncStatus';

const TrendCharts = lazy(() => import('@/charts/TrendCharts'));

interface TimelineItem {
  key: string;
  at: number;
  type: string;
  by: string;
  clinic: string;
  details: ReactNode;
  pending: boolean;
  href?: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-semibold text-slate-700">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

function ListOrNone({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-slate-700">None recorded</span>;
  return (
    <ul className="ml-5 list-disc">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

export default function PatientProfilePage() {
  const { patientId = '' } = useParams();
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;
  const ctx = useCtx();
  const online = useOnline();
  const { patients, patientsLoading, visits: allVisits, referrals: allReferrals, queued, clinic } = useClinicData();
  const patient = patients.find((p) => p.patientId === patientId) ?? null;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const visits = useMemo(() => allVisits.filter((v) => v.patientId === patientId), [allVisits, patientId]);
  const referrals = useMemo(
    () => allReferrals.filter((r) => r.patientId === patientId).sort((a, b) => (millis(b.createdAt) ?? 0) - (millis(a.createdAt) ?? 0)),
    [allReferrals, patientId],
  );
  const queuedHere = useMemo(() => queued.filter((q) => q.patientId === patientId), [queued, patientId]);

  // Audit once per open of this profile (guarded against StrictMode double effects).
  const audited = useRef<string | null>(null);
  const found = !!patient;
  useEffect(() => {
    if (found && audited.current !== patientId) {
      audited.current = patientId;
      logAudit(ctx, 'patient_viewed', patientId);
    }
  }, [found, patientId, ctx]);

  const latest = useMemo(() => {
    const asc = sortVisitsAsc(visits);
    return asc.length ? asc[asc.length - 1] : null;
  }, [visits]);
  const flags = useMemo(() => (latest ? visitRiskFlags(latest) : []), [latest]);
  const trends = useMemo(() => abnormalTrends(visits), [visits]);
  const meds = useMemo(() => currentMedications(visits), [visits]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const clinicName = clinic?.name ?? 'This clinic';
    const items: TimelineItem[] = visits.map((v) => {
      const signs = (Object.keys(DANGER_SIGN_LABELS) as (keyof DangerSigns)[]).filter((k) => v.dangerSigns?.[k]).map((k) => DANGER_SIGN_LABELS[k]);
      return {
        key: `v-${v.id}`,
        at: millis(v.createdAt) ?? Date.parse(`${v.visitDate}T00:00:00`),
        type: `Prenatal visit (${formatDate(v.visitDate)})`,
        by: v.createdByName,
        clinic: clinicName,
        pending: v._pending,
        details: (
          <>
            BP {v.bpSystolic}/{v.bpDiastolic} · Weight {v.weightKg} kg{v.fhr != null && ` · FHR ${v.fhr}`}
            {v.glucoseMgDl != null && ` · Glucose ${v.glucoseMgDl}`}
            {v.fundalHeightCm != null && ` · Fundal height ${v.fundalHeightCm} cm`} · Urine protein {URINE_LABELS[v.urineProtein]} · Urine glucose {URINE_LABELS[v.urineGlucose]}
            {signs.length > 0 && <span className="block font-semibold text-red-800">Danger signs: {signs.join(', ')}</span>}
            {v.notes && <span className="block whitespace-pre-line">Notes: {v.notes}</span>}
          </>
        ),
      };
    });
    for (const r of referrals) {
      items.push({
        key: `r-${r.id}`,
        at: millis(r.createdAt) ?? 0,
        type: r.type === 'emergency' ? 'Emergency referral' : 'Checkup referral',
        by: r.midwife?.name ?? '—',
        clinic: r.clinic?.name ?? clinicName,
        pending: r._pending,
        href: `/referrals/${r.id}`,
        details: (
          <>
            To {r.hospital?.name} · {STATUS_LABELS[r.status]} · {r.reason?.label}
          </>
        ),
      });
    }
    for (const q of queuedHere) {
      items.push({
        key: `q-${q.clientRequestId}`,
        at: q.queuedAt,
        type: 'Emergency referral (queued, not yet sent)',
        by: ctx.staffName,
        clinic: clinicName,
        pending: true,
        details: (
          <>
            To {q.hospitalName} · {q.reasonLabel}
          </>
        ),
      });
    }
    return items.sort((a, b) => b.at - a.at);
  }, [visits, referrals, queuedHere, clinic?.name, ctx.staffName]);

  if (patientsLoading) return <Loading />;
  if (!patient) {
    return (
      <Alert tone="error" title="Patient not found">
        This patient is not in your clinic records. <Link to="/patients" className="underline">Back to patients</Link>
      </Alert>
    );
  }

  const status = pregnancyStatus(patient.pregnancy?.lmp);
  const age = ageInYears(patient.birthdate);
  const consent = patient.consent?.dataSharingForReferral === true;

  async function exportPdf() {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const res = await api.generateReferralPdf({ patientId });
      downloadBase64Pdf(res.base64, res.fileName);
    } catch (err) {
      setPdfError(userMessage(err, 'Could not create the PDF. Please try again.'));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {flash && <Alert tone="success">{flash}</Alert>}
      <FailedReferralsPanel patientId={patient.patientId} />
      <PageHeader
        title={patient.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{patient.patientId}</span>
            <span>· {age !== null ? `${age} years old` : 'Age unknown'}</span>
            {consent ? <Badge tone="success">✓ Consent for referral sharing</Badge> : <Badge tone="warning">⚠ No consent for referral sharing</Badge>}
            {patient._pending && <Badge tone="warning">Pending sync</Badge>}
            {!patient.active && <Badge>Inactive</Badge>}
          </span>
        }
        actions={
          <ButtonLink to={`/patients/${patientId}/edit`} variant="secondary">
            Edit
          </ButtonLink>
        }
      />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ButtonLink to={`/patients/${patientId}/referral/emergency`} variant="danger" className="min-h-16 text-lg font-extrabold sm:col-span-2 lg:col-span-1">
          EMERGENCY REFERRAL
        </ButtonLink>
        <ButtonLink to={`/patients/${patientId}/visit/new`}>New Visit</ButtonLink>
        <ButtonLink to={`/patients/${patientId}/referral/checkup`} variant="secondary">
          Checkup Referral
        </ButtonLink>
        <Button variant="secondary" onClick={exportPdf} disabled={pdfBusy || !online} aria-describedby={!online ? 'pdf-offline' : undefined}>
          {pdfBusy ? 'Preparing PDF…' : 'Export PDF'}
        </Button>
      </div>
      {!online && (
        <p id="pdf-offline" className="text-sm text-slate-700">
          PDF export needs an internet connection.
        </p>
      )}
      {pdfError && <Alert tone="error">{pdfError}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Pregnancy">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="LMP">{formatDate(patient.pregnancy?.lmp)}</Field>
            <Field label="EDD">{formatDate(patient.pregnancy?.edd)}</Field>
            <Field label="Gravida / Para">
              G{patient.pregnancy?.gravida} P{patient.pregnancy?.para}
              <span className="block text-sm font-normal text-slate-700">{describeGravidaPara(patient.pregnancy?.gravida, patient.pregnancy?.para)}</span>
            </Field>
            <Field label="Gestational age">{status.gaLabel}</Field>
            <Field label="Trimester">{status.trimesterLabel}</Field>
            <Field label="Blood type">{patient.bloodType}</Field>
          </dl>
        </Card>
        <Card title="Contact">
          <dl className="grid gap-3">
            <Field label="Address">
              {patient.address}, {patient.barangay}
            </Field>
            <Field label="Mobile number">{patient.contactNumber}</Field>
            <Field label="Emergency contact">
              {patient.emergencyContact?.name} ({patient.emergencyContact?.relationship}) · {patient.emergencyContact?.contactNumber}
            </Field>
          </dl>
        </Card>
        <Card title="Current medications">
          <ListOrNone items={meds} />
        </Card>
        <Card title="Allergies">
          <ListOrNone items={patient.allergies ?? []} />
        </Card>
        <Card title="Medical history">
          <ListOrNone items={patient.medicalHistory ?? []} />
        </Card>
        <Card title="Obstetric history">
          <ListOrNone items={patient.obstetricHistory ?? []} />
        </Card>
      </div>

      <Card title="Risk flags">
        <p className="mb-2 text-sm text-slate-700">Highlights of recorded values. Not a diagnosis. Observation requires clinical review.</p>
        {flags.length === 0 && trends.length === 0 ? (
          <p className="text-slate-700">{latest ? 'No values at or beyond the configured review thresholds at the latest visit.' : 'No visits recorded yet.'}</p>
        ) : (
          <ul className="space-y-2">
            {flags.map((f) => (
              <li key={f.code} className="rounded-lg border-l-4 border-amber-600 bg-amber-50 p-2">
                <span className="font-bold">{f.label}</span> ({formatDate(f.visitDate)}): {f.detail}
              </li>
            ))}
            {trends.map((t) => (
              <li key={t} className="rounded-lg border-l-4 border-blue-700 bg-blue-50 p-2">
                <span className="font-bold">Documented trend:</span> {t} Observation requires clinical review.
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Trends">
        <Suspense fallback={<Loading label="Loading charts…" />}>
          <TrendCharts visits={visits} />
        </Suspense>
      </Card>

      <Card title="Timeline">
        {timeline.length === 0 ? (
          <p className="text-slate-700">No visits or referrals yet.</p>
        ) : (
          <ol className="space-y-3">
            {timeline.map((t) => (
              <li key={t.key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {t.href ? (
                    <Link to={t.href} className="font-bold text-brand-800 underline">
                      {t.type}
                    </Link>
                  ) : (
                    <span className="font-bold">{t.type}</span>
                  )}
                  {t.pending && <Badge tone="warning">Pending sync</Badge>}
                </div>
                <p className="text-sm text-slate-700">
                  <time dateTime={new Date(t.at).toISOString()}>{formatDateTime(t.at)}</time> · {t.by} · {t.clinic}
                </p>
                <p className="mt-1">{t.details}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Referral history">
        {referrals.length === 0 ? (
          <p className="text-slate-700">No referrals yet.</p>
        ) : (
          <ul className="space-y-3">
            {referrals.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                <Link to={`/referrals/${r.id}`} className="font-bold text-brand-800 underline">
                  {r.type === 'emergency' ? 'Emergency' : 'Checkup'} referral to {r.hospital?.name}
                </Link>
                <p className="text-sm text-slate-700">
                  {r.referralId} · {formatDateTime(millis(r.createdAt))} · {STATUS_LABELS[r.status]}
                </p>
                <div className="mt-1">
                  <StatusStepper type={r.type} status={r.status} history={(r.statusHistory ?? []).map((h) => h.status)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
