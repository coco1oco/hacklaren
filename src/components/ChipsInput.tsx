import { useId, useState } from 'react';

interface Props {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  error?: string;
  hint?: string;
}

/** Add/remove list entries as chips. Quick-add suggestions minimise typing on phones. */
export function ChipsInput({ label, value, onChange, suggestions = [], placeholder, error, hint }: Props) {
  const id = useId();
  const [text, setText] = useState('');

  function add(item: string) {
    const v = item.trim();
    if (!v) return;
    if (!value.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...value, v]);
    setText('');
  }

  const unused = suggestions.filter((s) => !value.some((x) => x.toLowerCase() === s.toLowerCase()));
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 font-semibold text-slate-900">{label}</legend>
      {value.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={`${label} entries`}>
          {value.map((item) => (
            <li key={item} className="flex items-center gap-1 rounded-full bg-brand-100 py-1 pl-3 pr-1 text-brand-900">
              <span>{item}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== item))}
                className="flex h-10 w-10 items-center justify-center rounded-full text-xl font-bold hover:bg-brand-50"
                aria-label={`Remove ${item}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-slate-600">None recorded.</p>
      )}
      <div className="flex gap-2">
        <label htmlFor={id} className="sr-only">
          Add to {label}
        </label>
        <input
          id={id}
          value={text}
          placeholder={placeholder ?? 'Type and press Add'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="block min-h-12 w-full rounded-lg border-2 border-slate-400 px-3 py-2 text-base focus:border-brand-800"
        />
        <button type="button" onClick={() => add(text)} className="min-h-12 shrink-0 rounded-lg border-2 border-brand-800 px-4 font-semibold text-brand-800 hover:bg-brand-50">
          Add
        </button>
      </div>
      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {unused.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="min-h-12 rounded-full border border-slate-400 bg-slate-50 px-3 text-sm hover:bg-slate-100">
              + {s}
            </button>
          ))}
        </div>
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-slate-700">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}
    </fieldset>
  );
}
