// Lazy-loaded chunk (recharts). Imported via React.lazy from patient profile and hospital view.
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReactNode } from 'react';
import type { VisitClinical } from '@shared/types';
import { REVIEW_THRESHOLDS, sortVisitsAsc } from '@shared/riskFlags';

interface SeriesDef {
  key: keyof VisitClinical;
  name: string;
  color: string;
  dashed?: boolean;
}

function ChartBlock({
  title,
  unit,
  visits,
  series,
  thresholds = [],
}: {
  title: string;
  unit: string;
  visits: VisitClinical[];
  series: SeriesDef[];
  thresholds?: { y: number; label: string }[];
}) {
  const data = visits.map((v) => {
    const row: Record<string, string | number | null> = { date: v.visitDate.slice(5) };
    for (const s of series) {
      const val = v[s.key];
      row[s.name] = typeof val === 'number' ? val : null;
    }
    return row;
  });
  const hasData = data.some((r) => series.some((s) => r[s.name] !== null));

  let body: ReactNode;
  if (!hasData) {
    body = <p className="text-slate-700">No {title.toLowerCase()} recorded.</p>;
  } else {
    body = (
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#334155' }} />
            <YAxis tick={{ fontSize: 12, fill: '#334155' }} domain={['auto', 'auto']} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            {thresholds.map((t) => (
              <ReferenceLine key={t.label} y={t.y} stroke="#b45309" strokeDasharray="4 4" label={{ value: t.label, fontSize: 11, fill: '#92400e', position: 'insideTopRight' }} />
            ))}
            {series.map((s) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={s.color}
                strokeWidth={2.5}
                strokeDasharray={s.dashed ? '6 4' : undefined}
                dot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <figure className="rounded-lg border border-slate-200 p-3">
      <figcaption className="mb-2 font-bold text-slate-900">
        {title} <span className="font-normal text-slate-700">({unit})</span>
      </figcaption>
      {body}
      {hasData && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer py-2 font-semibold text-brand-800">Show values as table</summary>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th scope="col" className="pr-2">
                  Date
                </th>
                {series.map((s) => (
                  <th scope="col" key={s.name} className="pr-2">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visits.map((v, i) => (
                <tr key={`${v.visitDate}-${i}`}>
                  <td className="pr-2">{v.visitDate}</td>
                  {series.map((s) => (
                    <td key={s.name} className="pr-2">
                      {typeof v[s.key] === 'number' ? String(v[s.key]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}

export default function TrendCharts({ visits }: { visits: VisitClinical[] }) {
  const asc = sortVisitsAsc(visits);
  if (!asc.length) return <p className="text-slate-700">No visits recorded yet.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartBlock
        title="Blood pressure"
        unit="mmHg"
        visits={asc}
        series={[
          { key: 'bpSystolic', name: 'Systolic', color: '#b91c1c' },
          { key: 'bpDiastolic', name: 'Diastolic', color: '#1d4ed8', dashed: true },
        ]}
        thresholds={[
          { y: REVIEW_THRESHOLDS.bpSystolicHigh, label: `Review ${REVIEW_THRESHOLDS.bpSystolicHigh}` },
          { y: REVIEW_THRESHOLDS.bpDiastolicHigh, label: `Review ${REVIEW_THRESHOLDS.bpDiastolicHigh}` },
        ]}
      />
      <ChartBlock title="Weight" unit="kg" visits={asc} series={[{ key: 'weightKg', name: 'Weight', color: '#0f766e' }]} />
      <ChartBlock title="Fetal heart rate" unit="bpm" visits={asc} series={[{ key: 'fhr', name: 'FHR', color: '#7c3aed' }]} />
      <ChartBlock title="Glucose" unit="mg/dL" visits={asc} series={[{ key: 'glucoseMgDl', name: 'Glucose', color: '#c2410c' }]} />
    </div>
  );
}
