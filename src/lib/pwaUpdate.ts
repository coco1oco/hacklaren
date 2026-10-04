import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

/**
 * Service worker registration in "prompt" mode. A new version is never activated automatically, because a reload
 * mid-workflow could lose a form or the one-time hospital link. The user chooses when to reload.
 */
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let needRefresh = false;
const listeners = new Set<() => void>();

export function initPwa(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      listeners.forEach((l) => l());
    },
  });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(subscribe, () => needRefresh, () => false);
}

export function applyUpdate(): void {
  if (updateSW) void updateSW(true);
  else window.location.reload();
}
