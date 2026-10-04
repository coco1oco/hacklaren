import { createLocalStore } from './localStore';

/** Emergency referral requests written to referralRequests while offline, awaiting server processing. */
export interface QueuedReferral {
  clientRequestId: string;
  patientId: string;
  patientName: string;
  hospitalName: string;
  hospitalPhone: string;
  reasonLabel: string;
  queuedAt: number;
}

export const queuedStore = createLocalStore<QueuedReferral[]>('mara.queuedReferrals', []);

/** clientRequestIds of failed emergency requests the midwife has acknowledged ("Dismiss"). */
export const dismissedFailedStore = createLocalStore<string[]>('mara.dismissedFailedRequests', []);

export function addQueued(q: QueuedReferral): void {
  queuedStore.update((list) => [...list.filter((x) => x.clientRequestId !== q.clientRequestId), q]);
}

export function removeQueued(ids: string[]): void {
  if (!ids.length) return;
  queuedStore.update((list) => list.filter((x) => !ids.includes(x.clientRequestId)));
}

/** Hides a failed request (its server doc cannot be deleted by clients) and drops it from the local queue. */
export function dismissFailedRequest(clientRequestId: string): void {
  dismissedFailedStore.update((list) => (list.includes(clientRequestId) ? list : [...list, clientRequestId]));
  removeQueued([clientRequestId]);
}
