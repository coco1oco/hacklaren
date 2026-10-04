import { signOut } from 'firebase/auth';
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore';
import { auth, db } from './firebase';
import { clearMaraLocalData } from './localStore';

const LOGOUT_MESSAGE_KEY = 'mara.logoutMessage';

/**
 * Full logout: sign out, terminate Firestore, wipe the IndexedDB cache and MARA local data, then reload.
 * Prevents patient data being left on shared devices.
 */
export async function hardLogout(message?: string): Promise<void> {
  try {
    if (message) sessionStorage.setItem(LOGOUT_MESSAGE_KEY, message);
  } catch {
    // ignore
  }
  try {
    await signOut(auth);
  } catch {
    // continue cleanup regardless
  }
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn('Could not clear the local Firestore cache', err);
  }
  clearMaraLocalData();
  window.location.replace('/login');
}

export function takeLogoutMessage(): string | null {
  try {
    const m = sessionStorage.getItem(LOGOUT_MESSAGE_KEY);
    if (m) sessionStorage.removeItem(LOGOUT_MESSAGE_KEY);
    return m;
  } catch {
    return null;
  }
}

export function sessionTimeoutMs(): number {
  const n = Number(import.meta.env.VITE_SESSION_TIMEOUT_MINUTES);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60_000;
}
