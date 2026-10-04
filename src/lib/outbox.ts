/**
 * Durable outbox for client-side clinical writes (patients, visits, offline emergency requests).
 *
 * Why: Firestore keeps offline writes in IndexedDB and re-sends them after a reload, but the promise that reports a
 * rejection (stale version, revoked access) only lives in memory. If the app is closed before the server answers, a
 * later rejection would otherwise drop clinical data silently.
 *
 * Behaviour (deterministic):
 * 1. BEFORE every clinical write, an entry `{ id, kind, docPath, payload, base, baseVersion, createdAt }` is persisted
 *    in localStorage under `mara.outbox.<uid>`. The payload is the plain, JSON-safe input (no FieldValue sentinels);
 *    for patient updates it holds only the CHANGED fields, `base` their previous values and `baseVersion` the version
 *    the edit was based on.
 * 2. In the same page session the write promise decides: resolved → entry removed; rejected → entry becomes a
 *    SyncConflict (conflict id = entry id) and is removed.
 * 3. Entries left over from an EARLIER page session (createdAt < SESSION_START) are reconciled once the device is
 *    online: wait for `waitForPendingWrites(db)` (Firestore has re-sent and settled the persisted queue), then for one
 *    `onSnapshotsInSync` tick, then read each target with `getDocFromServer`:
 *      - create: doc exists, createdBy == uid and key fields match (patientId / visitDate+BP / clientRequestId) → dropped.
 *      - update: server version >= baseVersion + 1, updatedBy == uid and the changed fields hold our values → dropped.
 *      - otherwise (missing doc, permission-denied, different values) → turned into a SyncConflict for review.
 *      - network errors → entry kept; retried on the next online event.
 * Known gap: with two tabs open, a tab started later may reconcile an entry whose write is still pending in the other
 * tab and raise a duplicate conflict. Re-applying or discarding it is safe.
 */
import { doc, getDocFromServer, onSnapshotsInSync, waitForPendingWrites } from 'firebase/firestore';
import { db } from './firebase';
import { createLocalStore } from './localStore';
import { describeWriteError, recordConflict, type ConflictKind } from './syncConflicts';

type Plain = Record<string, unknown>;

export interface OutboxEntry {
  id: string;
  kind: ConflictKind;
  docPath: string;
  patientId: string | null;
  label: string;
  payload: Plain;
  base: Plain | null;
  baseVersion: number | null;
  createdAt: number;
}

export type NewOutboxEntry = Omit<OutboxEntry, 'id' | 'createdAt' | 'base' | 'baseVersion'> & { base?: Plain | null; baseVersion?: number | null };

/** Start of this page session. Entries older than this belong to a previous session and need reconciliation. */
export const SESSION_START = Date.now();

const stores = new Map<string, ReturnType<typeof createLocalStore<OutboxEntry[]>>>();
const emptyStore = createLocalStore<OutboxEntry[]>('mara.outbox.__none__', []);

export function outboxStore(uid: string | null) {
  if (!uid) return emptyStore;
  let s = stores.get(uid);
  if (!s) {
    s = createLocalStore<OutboxEntry[]>(`mara.outbox.${uid}`, []);
    stores.set(uid, s);
  }
  return s;
}

/** Outbox entries for the signed-in user (React hook). */
export function useOutbox(uid: string | null): OutboxEntry[] {
  return outboxStore(uid).useValue();
}

function removeEntry(uid: string, id: string): void {
  outboxStore(uid).update((list) => list.filter((e) => e.id !== id));
}

function toConflict(e: OutboxEntry, error: string): void {
  recordConflict({
    id: e.id,
    kind: e.kind,
    docPath: e.docPath,
    patientId: e.patientId,
    label: e.label,
    payload: e.payload,
    base: e.base,
    baseVersion: e.baseVersion,
    attemptedAt: e.createdAt,
    error,
  });
}

/**
 * Persists the entry, then runs the write. Never awaited by the UI (offline-first).
 * A conflict is recorded before the entry is removed, so a crash in between can only cause a (deduplicated) retry.
 */
export function trackOutboxWrite(uid: string, entry: NewOutboxEntry, write: () => Promise<unknown>): void {
  const full: OutboxEntry = { base: null, baseVersion: null, ...entry, id: crypto.randomUUID(), createdAt: Date.now() };
  outboxStore(uid).update((list) => [...list, full]);
  let p: Promise<unknown>;
  try {
    p = write();
  } catch (err) {
    p = Promise.reject(err);
  }
  p.then(
    () => removeEntry(uid, full.id),
    (err: unknown) => {
      console.warn('Write rejected', full.kind, full.docPath);
      toConflict(full, describeWriteError(err));
      removeEntry(uid, full.id);
    },
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Does the server document already contain this outbox entry's write? Exported for unit tests. */
export function serverReflects(e: OutboxEntry, uid: string, data: Plain | null): boolean {
  if (!data) return false;
  const p = e.payload;
  switch (e.kind) {
    case 'patient_create':
      return data.createdBy === uid && data.patientId === p.patientId;
    case 'visit_create':
      return data.createdBy === uid && data.visitDate === p.visitDate && data.bpSystolic === p.bpSystolic && data.bpDiastolic === p.bpDiastolic;
    case 'referral_request':
      return data.createdBy === uid && data.clientRequestId === p.clientRequestId;
    case 'patient_update': {
      if (e.baseVersion === null || typeof data.version !== 'number' || data.version < e.baseVersion + 1 || data.updatedBy !== uid) return false;
      return Object.entries(p).every(([k, v]) =>
        k === 'consent'
          ? same((data.consent as Plain | undefined)?.dataSharingForReferral, (v as Plain | undefined)?.dataSharingForReferral)
          : same(data[k], v),
      );
    }
  }
}

function errorCode(err: unknown): string {
  return err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
}

const UNCONFIRMED =
  'This change was saved on this device, but the server never confirmed it (the app was closed before it synced, or the server rejected it). Review it and re-apply or discard.';

let running = false;

/**
 * Reconciles entries from previous page sessions. Safe to call repeatedly; concurrent calls are ignored.
 * Returns the number of entries that could not be checked yet (network), so the caller can retry later.
 */
export async function reconcileOutbox(uid: string): Promise<number> {
  if (running) return 0;
  const stale = () => outboxStore(uid).get().filter((e) => e.createdAt < SESSION_START);
  if (!stale().length) return 0;
  running = true;
  let deferred = 0;
  try {
    // Firestore re-sends the persisted mutation queue on start; wait until the server has answered all of it.
    await waitForPendingWrites(db);
    // ...and until local listeners reflect the server state.
    await new Promise<void>((resolve) => {
      let done = false;
      const unsub = onSnapshotsInSync(db, () => {
        if (done) return;
        done = true;
        resolve();
        queueMicrotask(() => unsub());
      });
    });
    for (const e of stale()) {
      let data: Plain | null;
      try {
        const snap = await getDocFromServer(doc(db, e.docPath));
        data = snap.exists() ? (snap.data() as Plain) : null;
      } catch (err) {
        // Reading a missing doc is denied by rules (resource is null); access may also have been revoked.
        if (errorCode(err) === 'permission-denied') data = null;
        else {
          deferred++;
          continue;
        }
      }
      if (!serverReflects(e, uid, data)) toConflict(e, UNCONFIRMED);
      removeEntry(uid, e.id);
    }
  } catch (err) {
    console.warn('Outbox reconciliation postponed', err);
    deferred = stale().length;
  } finally {
    running = false;
  }
  return deferred;
}
