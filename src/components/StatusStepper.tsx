import { Fragment } from 'react';
import type { ReferralStatus, ReferralType } from '@shared/types';
import { STATUS_LABELS } from '@shared/referralStatus';

const END_STATES: ReferralStatus[] = ['DECLINED', 'CANCELLED', 'EXPIRED'];

/** ● current  ✓ done  ○ not yet. Updates in real time from the referral doc. */
export function StatusStepper({ type, status, history }: { type: ReferralType; status: ReferralStatus; history: ReferralStatus[] }) {
  const steps: ReferralStatus[] = type === 'checkup' ? ['CREATED', 'SENT', 'ACKNOWLEDGED', 'ARRIVED'] : ['SENT', 'ACKNOWLEDGED', 'ARRIVED'];
  const reached = new Set<ReferralStatus>([...history, status]);
  const ended = END_STATES.includes(status);

  return (
    <div>
      <ol aria-label="Referral progress" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
        {steps.map((step, i) => {
          const done = reached.has(step) && (step !== status || step === 'ARRIVED');
          const current = step === status && step !== 'ARRIVED';
          const symbol = done ? '✓' : current ? '●' : '○';
          const color = done ? 'text-green-800' : current ? 'text-brand-800' : 'text-slate-500';
          return (
            <Fragment key={step}>
              {i > 0 && (
                <li aria-hidden="true" className="text-slate-400">
                  →
                </li>
              )}
              <li className={color} aria-current={current ? 'step' : undefined}>
                <span aria-hidden="true">{symbol} </span>
                {STATUS_LABELS[step].toUpperCase()}
                <span className="sr-only">{done ? ' (done)' : current ? ' (current)' : ' (not yet)'}</span>
              </li>
            </Fragment>
          );
        })}
        {ended && (
          <>
            <li aria-hidden="true" className="text-slate-400">
              →
            </li>
            <li className="text-red-800">
              <span aria-hidden="true">✕ </span>
              {STATUS_LABELS[status].toUpperCase()}
            </li>
          </>
        )}
      </ol>
      <p aria-live="polite" className="sr-only">
        Referral status: {STATUS_LABELS[status]}
      </p>
    </div>
  );
}
