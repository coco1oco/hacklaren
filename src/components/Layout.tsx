import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useClinicData } from '@/data/ClinicDataProvider';
import { hardLogout } from '@/lib/session';
import { useOnline } from '@/lib/useOnline';
import { Loading } from './ui';

export function OfflineBanner() {
  const online = useOnline();
  return (
    <div aria-live="polite" className="no-print">
      {!online && (
        <p className="bg-amber-200 px-4 py-2 text-center font-semibold text-amber-950">
          Offline. You can keep working; changes will sync when the connection returns.
        </p>
      )}
    </div>
  );
}

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '⌂' },
  { to: '/patients', label: 'Patients', sub: 'Pasyente', icon: '♀' },
  { to: '/referrals', label: 'Referrals', icon: '⇄' },
  { to: '/help', label: 'Help', icon: '?' },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-12 items-center rounded-lg px-3 font-semibold ${isActive ? 'bg-brand-800 text-white' : 'text-slate-900 hover:bg-slate-100'}`;
}

export function Layout() {
  const { staff, user, claims } = useAuth();
  const { unsyncedCount: unsynced } = useClinicData();
  const isAdmin = claims?.role === 'clinic_admin' || claims?.role === 'super_admin';

  function logout() {
    if (unsynced > 0) {
      const ok = window.confirm(
        `${unsynced} item(s) have not synchronized with the server yet. Logging out now clears this device and they will be permanently lost.\n\nConnect to the internet and wait for "✓ Synced" first. Log out anyway?`,
      );
      if (!ok) return;
    }
    void hardLogout();
  }

  return (
    <div className="flex min-h-screen flex-col pb-20 md:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <NavLink to="/dashboard" className="text-xl font-extrabold text-brand-800">
            MARA
          </NavLink>
          <nav aria-label="Main" className="hidden gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={navClass}>
                {n.label}
              </NavLink>
            ))}
            <NavLink to="/hospitals" className={navClass}>
              Hospitals
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            )}
          </nav>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-700 sm:inline">{staff?.name ?? user?.email}</span>
            {isAdmin && (
              <NavLink to="/admin" className="flex min-h-12 items-center rounded-lg px-3 font-semibold text-brand-800 md:hidden">
                Admin
              </NavLink>
            )}
            <button type="button" onClick={logout} className="min-h-12 rounded-lg border-2 border-slate-400 px-3 font-semibold hover:bg-slate-100">
              Log out
            </button>
          </div>
        </div>
      </header>
      <OfflineBanner />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">
        <Suspense fallback={<Loading />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="no-print px-4 py-4 text-center text-sm text-slate-600">Designed to complement existing referral workflows.</footer>
      <nav aria-label="Main (bottom)" className="no-print fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-300 bg-white md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-800'}`}
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
