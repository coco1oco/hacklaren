import { useHospitals } from '@/data/hospitals';
import { telHref } from '@/lib/format';
import { Alert, Badge, Loading, PageHeader } from '@/components/ui';

export default function HospitalsPage() {
  const { data, loading, error } = useHospitals();
  const hospitals = data.filter((h) => h.active);

  return (
    <div>
      <PageHeader title="Hospitals" subtitle="Receiving facilities directory" />
      {error && <Alert tone="error">Could not load hospitals. Check your connection and try again.</Alert>}
      {loading ? (
        <Loading label="Loading hospitals…" />
      ) : hospitals.length === 0 ? (
        <p className="text-slate-700">No hospitals have been added yet.</p>
      ) : (
        <ul className="space-y-3">
          {hospitals.map((h) => (
            <li key={h.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">{h.name}</h2>
              <p className="text-slate-700">{h.address}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="neutral">Level {h.referralLevel}</Badge>
                {h.services.map((s) => (
                  <Badge key={s} tone="brand">
                    {s}
                  </Badge>
                ))}
                {h.dohNetworked && <Badge tone="info">DOH-networked</Badge>}
              </div>
              <a href={telHref(h.phone)} className="mt-3 inline-flex min-h-12 items-center rounded-lg border-2 border-brand-800 px-4 font-semibold text-brand-800 hover:bg-brand-50">
                Call {h.phone}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
