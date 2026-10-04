// Data hooks for the clinic-side referral screens. All queries are clinic-scoped (rules reject unfiltered queries).
import { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { COLLECTIONS, type HospitalDoc, type SmsLogDoc, type VisitDoc } from '@shared/contracts';
import type { LatLng } from '@shared/geo';
import { db } from '@/lib/firebase';
import { useCollection, type WithMeta } from '@/lib/firestore';

export type HospitalRow = WithMeta<HospitalDoc>;

/** All hospitals (readable by any signed-in staff). Filter for `active` at the call site. */
export function useHospitals() {
  const q = useMemo(() => query(collection(db, COLLECTIONS.hospitals)), []);
  return useCollection<HospitalDoc>(q);
}

/** Visits of one patient, filtered by clinic so the query satisfies the security rules. */
export function usePatientVisits(patientId: string | undefined, clinicId: string | null) {
  const q = useMemo(
    () => (patientId && clinicId ? query(collection(db, COLLECTIONS.patients, patientId, COLLECTIONS.visits), where('clinicId', '==', clinicId)) : null),
    [patientId, clinicId],
  );
  return useCollection<VisitDoc>(q);
}

/** SMS logs for one referral. Needs both clinicId and referralId filters (rules). */
export function useSmsLogs(referralId: string | undefined, clinicId: string | null) {
  const q = useMemo(
    () =>
      referralId && clinicId
        ? query(collection(db, COLLECTIONS.smsLogs), where('clinicId', '==', clinicId), where('referralId', '==', referralId))
        : null,
    [referralId, clinicId],
  );
  return useCollection<SmsLogDoc>(q);
}

export type PositionState = { status: 'pending' } | { status: 'ok'; position: LatLng } | { status: 'unavailable' };

/** One-shot browser geolocation. Never blocks the form: callers fall back to the clinic location. */
export function useCurrentPosition(): PositionState {
  const [state, setState] = useState<PositionState>(() =>
    typeof navigator !== 'undefined' && 'geolocation' in navigator ? { status: 'pending' } : { status: 'unavailable' },
  );
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return undefined;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!cancelled) setState({ status: 'ok', position: { latitude: p.coords.latitude, longitude: p.coords.longitude } });
      },
      () => {
        if (!cancelled) setState({ status: 'unavailable' });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
