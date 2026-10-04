import { useId } from 'react';
import type { HospitalDoc } from '@shared/contracts';
import { formatDistance } from '@shared/geo';
import type { WithMeta } from '@/lib/firestore';
import { ServiceBadges } from './ReferralBits';

export interface HospitalOption {
  hospital: WithMeta<HospitalDoc>;
  /** null = not shown (checkup) or unknown. */
  distanceKm: number | null;
}

/** Accessible radio list. Each radio's accessible name is the hospital name; details are its description. */
export function HospitalPicker({
  options,
  value,
  onChange,
  legend,
  error,
  showDistance,
  name,
}: {
  options: HospitalOption[];
  value: string;
  onChange: (id: string) => void;
  legend: string;
  error?: string;
  showDistance: boolean;
  name: string;
}) {
  const base = useId();
  return (
    <fieldset aria-describedby={error ? `${base}-err` : undefined}>
      <legend className="mb-2 text-lg font-bold text-slate-900">{legend}</legend>
      {options.length === 0 && <p className="text-slate-800">No eligible hospitals are available. Contact your administrator.</p>}
      <ul className="grid gap-2">
        {options.map(({ hospital: h, distanceKm }, i) => {
          const id = `${base}-${i}`;
          const checked = value === h.id;
          return (
            <li key={h.id}>
              <label
                htmlFor={id}
                className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border-2 p-3 ${checked ? 'border-brand-800 bg-brand-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
              >
                <input
                  id={id}
                  type="radio"
                  name={name}
                  value={h.id}
                  checked={checked}
                  onChange={() => onChange(h.id)}
                  aria-labelledby={`${id}-name`}
                  aria-describedby={`${id}-desc`}
                  className="mt-1 h-6 w-6 shrink-0 accent-brand-800"
                />
                <span className="flex-1">
                  <span id={`${id}-name`} className="block font-bold text-slate-900">
                    {h.name}
                  </span>
                  <span id={`${id}-desc`} className="mt-1 block text-sm text-slate-800">
                    {showDistance && <span className="mr-2 font-semibold">{formatDistance(distanceKm)} (straight line)</span>}
                    <span className="mr-2">Level {h.referralLevel}</span>
                    {h.phone && <span className="mr-2 font-mono">{h.phone}</span>}
                    <span className="mt-1 block">
                      <ServiceBadges services={h.services} />
                    </span>
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p id={`${base}-err`} className="mt-1 font-semibold text-red-800">
          {error}
        </p>
      )}
    </fieldset>
  );
}
