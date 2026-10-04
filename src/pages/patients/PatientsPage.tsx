import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useClinicData } from '@/data/ClinicDataProvider';
import { normalizeName } from '@/lib/format';
import { pregnancyStatus } from '@/lib/pregnancyView';
import { Alert, Badge, ButtonLink, Loading, PageHeader } from '@/components/ui';

export default function PatientsPage() {
  const { patients, patientsLoading, patientsError } = useClinicData();
  const [q, setQ] = useState('');
  const searchId = useId();

  const results = useMemo(() => {
    const term = normalizeName(q);
    const idTerm = q.trim().toUpperCase();
    return patients
      .filter((p) => !term || p.nameLower.includes(term) || p.patientId.includes(idTerm))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [patients, q]);

  return (
    <div>
      <PageHeader title="Patients" subtitle="Mga pasyente" actions={<ButtonLink to="/patients/new">Add Patient</ButtonLink>} />
      <div role="search" className="mb-4">
        <label htmlFor={searchId} className="mb-1 block font-semibold">
          Search patients
        </label>
        <input
          id={searchId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or Patient ID (MARA-PAT-…)"
          autoComplete="off"
          className="block min-h-12 w-full rounded-lg border-2 border-slate-400 px-3 py-2 text-base focus:border-brand-800"
        />
      </div>
      {patientsError && <Alert tone="error">Could not load patients. Check your connection and try again.</Alert>}
      {patientsLoading ? (
        <Loading label="Loading patients…" />
      ) : (
        <>
          <p aria-live="polite" className="mb-2 text-sm text-slate-700">
            {results.length} {results.length === 1 ? 'patient' : 'patients'} {q ? 'found' : ''}
          </p>
          {results.length === 0 ? (
            <p className="text-slate-700">{q ? 'No matching patients. Check the spelling or search by Patient ID.' : 'No patients registered yet.'}</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {results.map((p) => {
                const s = pregnancyStatus(p.pregnancy?.lmp);
                return (
                  <li key={p.id}>
                    <Link to={`/patients/${p.patientId}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                      <span>
                        <span className="block font-bold text-brand-800 underline">{p.name}</span>
                        <span className="block text-sm text-slate-700">
                          {p.patientId} · {p.barangay}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                        {s.gaLabel} · {s.trimesterLabel}
                        {!p.active && <Badge>Inactive</Badge>}
                        {p._pending && <Badge tone="warning">Pending sync</Badge>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
