import type { ReactNode } from 'react';
import { OfflineBanner } from '@/components/Layout';

/** Shared frame for the public auth screens (sign in, clinic sign-up, join with server code). */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <OfflineBanner />
      <main id="main" className="mx-auto max-w-md p-6">
        <p className="text-3xl font-extrabold text-brand-800">MARA</p>
        <p className="text-slate-700">Maternal Referral and Admission</p>
        <h1 className="mt-6 text-xl font-bold">{title}</h1>
        {children}
        <p className="mt-8 text-sm text-slate-600">Designed to complement existing referral workflows.</p>
      </main>
    </>
  );
}
