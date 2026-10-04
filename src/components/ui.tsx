import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-800 text-white hover:bg-brand-900 disabled:bg-slate-400',
  secondary: 'border-2 border-slate-400 bg-white text-slate-900 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400',
  ghost: 'text-brand-800 underline underline-offset-2 hover:bg-brand-50',
};

export function buttonClass(variant: Variant = 'primary', extra = ''): string {
  return `inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2 text-center text-base font-semibold disabled:cursor-not-allowed ${VARIANTS[variant]} ${extra}`;
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}

export function ButtonLink({ variant = 'primary', className = '', ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

export function Card({ title, children, className = '', actions, id }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={title ? headingId : undefined} id={id} className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 id={headingId} className="text-lg font-bold text-slate-900">
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'info' | 'warning' | 'error' | 'success';
const ALERT_TONES: Record<Tone, string> = {
  info: 'border-blue-700 bg-blue-50 text-blue-950',
  warning: 'border-amber-600 bg-amber-50 text-amber-950',
  error: 'border-red-700 bg-red-50 text-red-950',
  success: 'border-green-700 bg-green-50 text-green-950',
};

export function Alert({ tone = 'info', title, children, className = '' }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border-l-4 p-3 ${ALERT_TONES[tone]} ${className}`}>
      {title && <p className="font-bold">{title}</p>}
      {children && <div className="mt-1">{children}</div>}
    </div>
  );
}

const BADGE_TONES: Record<Tone | 'neutral' | 'brand', string> = {
  info: 'bg-blue-100 text-blue-900',
  warning: 'bg-amber-100 text-amber-900',
  error: 'bg-red-100 text-red-900',
  success: 'bg-green-100 text-green-900',
  neutral: 'bg-slate-200 text-slate-900',
  brand: 'bg-brand-100 text-brand-900',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${BADGE_TONES[tone]}`}>{children}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="p-4 text-slate-700">
      {label}
    </p>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-slate-700">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const INPUT_CLASS =
  'block w-full min-h-12 rounded-lg border-2 border-slate-400 bg-white px-3 py-2 text-base text-slate-900 focus:border-brand-800 aria-[invalid=true]:border-red-700';

interface FieldMeta {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  warning?: string;
}

function describedBy(id: string, m: FieldMeta): string | undefined {
  const ids = [m.hint && `${id}-hint`, m.warning && `${id}-warning`, m.error && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function FieldMessages({ id, hint, error, warning }: Omit<FieldMeta, 'label'> & { id: string }) {
  return (
    <>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-slate-700">
          {hint}
        </p>
      )}
      {warning && (
        <p id={`${id}-warning`} className="mt-1 text-sm font-medium text-amber-800">
          ⚠ {warning}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-red-800">
          {error}
        </p>
      )}
    </>
  );
}

export function TextField({
  label,
  hint,
  error,
  warning,
  ref,
  className = '',
  id: idProp,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldMeta & { ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-semibold text-slate-900">
        {label}
      </label>
      <input ref={ref} id={id} className={INPUT_CLASS} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { label, hint, error, warning })} {...props} />
      <FieldMessages id={id} hint={hint} error={error} warning={warning} />
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  warning,
  ref,
  className = '',
  id: idProp,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldMeta & { ref?: Ref<HTMLTextAreaElement> }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-semibold text-slate-900">
        {label}
      </label>
      <textarea ref={ref} id={id} rows={3} className={INPUT_CLASS} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { label, hint, error, warning })} {...props} />
      <FieldMessages id={id} hint={hint} error={error} warning={warning} />
    </div>
  );
}

export function SelectField({
  label,
  hint,
  error,
  warning,
  ref,
  className = '',
  id: idProp,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldMeta & { ref?: Ref<HTMLSelectElement> }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-semibold text-slate-900">
        {label}
      </label>
      <select ref={ref} id={id} className={INPUT_CLASS} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { label, hint, error, warning })} {...props}>
        {children}
      </select>
      <FieldMessages id={id} hint={hint} error={error} warning={warning} />
    </div>
  );
}

export function CheckboxField({
  label,
  hint,
  error,
  ref,
  className = '',
  id: idProp,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & Omit<FieldMeta, 'warning'> & { ref?: Ref<HTMLInputElement> }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={className}>
      <div className="flex min-h-12 items-center gap-3">
        <input ref={ref} id={id} type="checkbox" className="h-6 w-6 shrink-0 accent-brand-800" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, { label, hint, error })} {...props} />
        <label htmlFor={id} className="font-medium text-slate-900">
          {label}
        </label>
      </div>
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

/** Polite live region for announcing status changes to screen readers. */
export function LiveText({ children, className = 'sr-only' }: { children: ReactNode; className?: string }) {
  return (
    <p aria-live="polite" className={className}>
      {children}
    </p>
  );
}
