import { useSyncExternalStore } from 'react';

/** Tiny JSON-in-localStorage store with React subscription. Keys must start with "mara." (cleared on logout). */
export function createLocalStore<T>(key: string, fallback: T) {
  let cachedRaw: string | null | undefined;
  let cached: T = fallback;
  const listeners = new Set<() => void>();

  function get(): T {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        cached = raw ? (JSON.parse(raw) as T) : fallback;
      } catch {
        cached = fallback;
      }
    }
    return cached;
  }

  function set(next: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch (err) {
      console.error(`Could not persist ${key}`, err);
    }
    listeners.forEach((l) => l());
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) listener();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }

  function useValue(): T {
    return useSyncExternalStore(subscribe, get, () => fallback);
  }

  return { get, set, update: (fn: (prev: T) => T) => set(fn(get())), subscribe, useValue };
}

export function clearMaraLocalData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mara.')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
