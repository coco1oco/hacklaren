import { useMemo } from 'react';
import { collection, query } from 'firebase/firestore';
import { COLLECTIONS, type ClinicDoc, type HospitalDoc } from '@shared/contracts';
import { db } from '@/lib/firebase';
import { useCollection, type CollectionState } from '@/lib/firestore';

/** All hospitals (readable by any staff). Sorted by name; filter `active` in the caller when needed. */
export function useHospitals(): CollectionState<HospitalDoc> {
  const q = useMemo(() => query(collection(db, COLLECTIONS.hospitals)), []);
  const state = useCollection<HospitalDoc>(q);
  const data = useMemo(() => [...state.data].sort((a, b) => a.name.localeCompare(b.name)), [state.data]);
  return { ...state, data };
}

/** All clinics. Only super_admin may list every clinic (rules); pass enabled=false otherwise. */
export function useAllClinics(enabled: boolean): CollectionState<ClinicDoc> {
  const q = useMemo(() => (enabled ? query(collection(db, COLLECTIONS.clinics)) : null), [enabled]);
  const state = useCollection<ClinicDoc>(q);
  const data = useMemo(() => [...state.data].sort((a, b) => a.name.localeCompare(b.name)), [state.data]);
  return { ...state, data };
}
