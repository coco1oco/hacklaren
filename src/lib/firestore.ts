import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentData, type DocumentReference, type Query } from 'firebase/firestore';

/** A Firestore document plus its id and local sync metadata. */
export type WithMeta<T> = T & { id: string; _pending: boolean };

export interface CollectionState<T> {
  data: WithMeta<T>[];
  loading: boolean;
  error: Error | null;
  /** Docs with local writes not yet acknowledged by the server. */
  pendingCount: number;
}

/**
 * Realtime query listener. Pass a memoised query (useMemo) or null to disable.
 * includeMetadataChanges lets the UI show per-document "pending sync" state.
 */
export function useCollection<T>(q: Query<DocumentData> | null): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({ data: [], loading: q !== null, error: null, pendingCount: 0 });
  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null, pendingCount: 0 });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const data = snap.docs.map((d) => ({
          ...(d.data({ serverTimestamps: 'estimate' }) as T),
          id: d.id,
          _pending: d.metadata.hasPendingWrites,
        }));
        setState({ data, loading: false, error: null, pendingCount: data.filter((x) => x._pending).length });
      },
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
  }, [q]);
  return state;
}

export interface DocState<T> {
  data: WithMeta<T> | null;
  loading: boolean;
  error: Error | null;
}

export function useDoc<T>(ref: DocumentReference<DocumentData> | null): DocState<T> {
  const [state, setState] = useState<DocState<T>>({ data: null, loading: ref !== null, error: null });
  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        setState({
          data: snap.exists()
            ? { ...(snap.data({ serverTimestamps: 'estimate' }) as T), id: snap.id, _pending: snap.metadata.hasPendingWrites }
            : null,
          loading: false,
          error: null,
        });
      },
      (error) => setState({ data: null, loading: false, error }),
    );
  }, [ref]);
  return state;
}
