import { createLocalStore } from './localStore';

/**
 * A local write the server rejected (e.g. rules refused a stale version), or one the outbox could not confirm after a
 * reload. The attempted payload is kept in localStorage so clinical data is never silently dropped; the user re-applies
 * or explicitly discards it.
 */
export type ConflictKind = 'patient_create' | 'patient_update' | 'visit_create' | 'referral_request';

export interface SyncConflict {
  id: string;
  kind: ConflictKind;
  docPath: string;
  patientId: string | null;
  label: string;
  /** JSON-safe payload (no server timestamp sentinels). For patient_update: only the CHANGED fields. */
  payload: Record<string, unknown>;
  /** patient_update only: the values of the changed fields in the record the edit was based on. */
  base?: Record<string, unknown> | null;
  /** patient_update only: version of the record the edit was based on. */
  baseVersion?: number | null;
  attemptedAt: number;
  error: string;
}

export const conflictStore = createLocalStore<SyncConflict[]>('mara.syncConflicts', []);

export function describeWriteError(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (code === 'permission-denied') {
    return 'The server rejected this change. The record may have been changed by someone else, or you may no longer have access.';
  }
  if (code === 'already-exists') return 'A record with this ID already exists.';
  return 'The change could not be saved to the server.';
}

/** Records a conflict. If `id` is given and already present, nothing is added (idempotent per outbox entry). */
export function recordConflict(c: Omit<SyncConflict, 'id' | 'attemptedAt'> & { id?: string; attemptedAt?: number }): void {
  conflictStore.update((list) => {
    if (c.id && list.some((x) => x.id === c.id)) return list;
    return [...list, { ...c, id: c.id ?? crypto.randomUUID(), attemptedAt: c.attemptedAt ?? Date.now() }];
  });
}

export function removeConflict(id: string): void {
  conflictStore.update((list) => list.filter((c) => c.id !== id));
}
