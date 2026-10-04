import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Loading } from '@/components/ui';
import { applyUpdate, useUpdateAvailable } from '@/lib/pwaUpdate';

/** Non-blocking "new version" notice. Never reloads on its own. */
function UpdateBanner() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div role="status" className="no-print fixed inset-x-2 bottom-20 z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-slate-900 px-4 py-2 text-white shadow-lg md:bottom-4">
      <span>Update available. Finish what you are doing, then reload.</span>
      <button type="button" onClick={applyUpdate} className="min-h-12 rounded-lg bg-white px-3 font-semibold text-slate-900">
        Reload
      </button>
    </div>
  );
}

// The public hospital view is fully separate from the staff app: no Firebase Auth, no staff providers,
// and no admin/staff code in its chunk. Everything else lives in the lazily loaded StaffApp.
const HospitalReferralPage = lazy(() => import('@/pages/hospital/HospitalReferralPage'));
const StaffApp = lazy(() => import('@/StaffApp'));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/referral/:token" element={<HospitalReferralPage />} />
          <Route path="*" element={<StaffApp />} />
        </Routes>
      </Suspense>
      <UpdateBanner />
    </BrowserRouter>
  );
}
