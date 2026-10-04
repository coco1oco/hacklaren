import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, collectionGroup, doc, query, where } from 'firebase/firestore';
import { COLLECTIONS, type ClinicDoc, type PatientDoc, type ReferralDoc, type ReferralRequestDoc, type VisitDoc } from '@shared/contracts';
import { db } from '@/lib/firebase';
import { useCollection, useDoc, type WithMeta } from '@/lib/firestore';
import { dismissedFailedStore, queuedStore, removeQueued, type QueuedReferral } from '@/lib/queuedReferrals';
import { conflictStore, type SyncConflict } from '@/lib/syncConflicts';
import { reconcileOutbox, useOutbox } from '@/lib/outbox';
import { useOnline } from '@/lib/useOnline';
import { useAuth } from '@/auth/AuthProvider';

/** An offline emergency request the server could not turn into a referral. The hospital has NOT received it. */
export interface FailedReferral {
  clientRequestId: string;
  patientId: string;
  patientName: string;
  hospitalName: string | null;
  hospitalPhone: string | null;
  reasonLabel: string | null;
  error: string;
}

export interface ClinicData {
  clinicId: string | null;
  clinic: WithMeta<ClinicDoc> | null;
  patients: WithMeta<PatientDoc>[];
  patientsLoading: boolean;
  patientsError: Error | null;
  referrals: WithMeta<ReferralDoc>[];
  referralsLoading: boolean;
  /** All visits of the clinic (collection-group listener), each with its pending-sync flag. */
  visits: WithMeta<VisitDoc>[];
  /** Emergency requests queued offline that are still waiting (no referral yet, not failed). */
  queued: QueuedReferral[];
  /** Emergency requests that failed server-side and were not dismissed. */
  failedRequests: FailedReferral[];
  conflicts: SyncConflict[];
  /** Patients + visits with unsynced local writes + queued emergency requests. */
  pendingCount: number;
  /** Everything that would be lost by wiping this device: pending writes / outbox entries + conflicts. */
  unsyncedCount: number;
}

const empty: ClinicData = {
  clinicId: null,
  clinic: null,
  patients: [],
  patientsLoading: false,
  patientsError: null,
  referrals: [],
  referralsLoading: false,
  visits: [],
  queued: [],
  failedRequests: [],
  conflicts: [],
  pendingCount: 0,
  unsyncedCount: 0,
};

const ClinicDataContext = createContext<ClinicData>(empty);

/** Reconciles durable-outbox entries left over from a previous session once the device is online. */
function OutboxReconciler({ uid }: { uid: string }) {
  const online = useOnline();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!online) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    void reconcileOutbox(uid).then((deferred) => {
      if (!cancelled && deferred > 0) timer = window.setTimeout(() => setRetry((n) => n + 1), 30_000);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [uid, online, retry]);
  return null;
}

/**
 * Shared clinic-scoped realtime listeners (one per app session, served from cache offline).
 * No listener is opened without a clinicId (super_admin never subscribes to clinical collections).
 */
export function ClinicDataProvider({ children }: { children: ReactNode }) {
  const { claims, user } = useAuth();
  const clinicId = claims?.clinicId ?? null;
  const uid = user?.uid ?? null;

  const clinicRef = useMemo(() => (clinicId ? doc(db, COLLECTIONS.clinics, clinicId) : null), [clinicId]);
  const patientsQ = useMemo(() => (clinicId ? query(collection(db, COLLECTIONS.patients), where('clinicId', '==', clinicId)) : null), [clinicId]);
  const visitsQ = useMemo(() => (clinicId ? query(collectionGroup(db, COLLECTIONS.visits), where('clinicId', '==', clinicId)) : null), [clinicId]);
  const referralsQ = useMemo(() => (clinicId ? query(collection(db, COLLECTIONS.referrals), where('clinicId', '==', clinicId)) : null), [clinicId]);
  // Own offline emergency requests (rules: createdBy == uid). Used to surface server-side failures.
  const requestsQ = useMemo(
    () => (clinicId && uid ? query(collection(db, COLLECTIONS.referralRequests), where('createdBy', '==', uid)) : null),
    [clinicId, uid],
  );

  const clinic = useDoc<ClinicDoc>(clinicRef);
  const patients = useCollection<PatientDoc>(patientsQ);
  const visits = useCollection<VisitDoc>(visitsQ);
  const referrals = useCollection<ReferralDoc>(referralsQ);
  const requests = useCollection<ReferralRequestDoc>(requestsQ);
  const queuedAll = queuedStore.useValue();
  const dismissed = dismissedFailedStore.useValue();
  const conflicts = conflictStore.useValue();
  const outbox = useOutbox(uid);

  const clinicRequests = useMemo(() => requests.data.filter((r) => r.clinicId === clinicId), [requests.data, clinicId]);

  // A queued request is done once a referral with the same clientRequestId exists (or the request says processed).
  const processedIds = useMemo(() => {
    const s = new Set(referrals.data.map((r) => r.clientRequestId));
    clinicRequests.forEach((r) => r.state === 'processed' && s.add(r.id));
    return s;
  }, [referrals.data, clinicRequests]);
  const failedAll = useMemo(() => clinicRequests.filter((r) => r.state === 'failed' && !processedIds.has(r.id)), [clinicRequests, processedIds]);
  const failedIds = useMemo(() => new Set(failedAll.map((r) => r.id)), [failedAll]);

  const queued = useMemo(
    () => queuedAll.filter((q) => !processedIds.has(q.clientRequestId) && !failedIds.has(q.clientRequestId)),
    [queuedAll, processedIds, failedIds],
  );
  useEffect(() => {
    const done = queuedAll.filter((q) => processedIds.has(q.clientRequestId)).map((q) => q.clientRequestId);
    removeQueued(done);
  }, [queuedAll, processedIds]);

  const failedRequests = useMemo<FailedReferral[]>(
    () =>
      failedAll
        .filter((r) => !dismissed.includes(r.id))
        .map((r) => {
          const local = queuedAll.find((q) => q.clientRequestId === r.id);
          return {
            clientRequestId: r.id,
            patientId: r.patientId,
            patientName: local?.patientName ?? patients.data.find((p) => p.patientId === r.patientId)?.name ?? r.patientId,
            hospitalName: local?.hospitalName || null,
            hospitalPhone: local?.hospitalPhone || null,
            reasonLabel: local?.reasonLabel || null,
            error: (r.error || 'Unknown error').replace(/[.\s]+$/, ''),
          };
        }),
    [failedAll, dismissed, queuedAll, patients.data],
  );

  const value = useMemo<ClinicData>(() => {
    const pendingCount = patients.pendingCount + visits.pendingCount + queued.length;
    return {
      clinicId,
      clinic: clinic.data,
      patients: patients.data,
      patientsLoading: patients.loading,
      patientsError: patients.error,
      referrals: referrals.data,
      referralsLoading: referrals.loading,
      visits: visits.data,
      queued,
      failedRequests,
      conflicts,
      pendingCount,
      // Outbox entries usually overlap with pending docs, so take the larger of the two instead of summing.
      unsyncedCount: Math.max(pendingCount, outbox.length) + conflicts.length,
    };
  }, [clinicId, clinic.data, patients, visits.data, visits.pendingCount, referrals, queued, failedRequests, conflicts, outbox.length]);

  return (
    <ClinicDataContext.Provider value={value}>
      {uid && clinicId && <OutboxReconciler uid={uid} />}
      {children}
    </ClinicDataContext.Provider>
  );
}

export function useClinicData(): ClinicData {
  return useContext(ClinicDataContext);
}
