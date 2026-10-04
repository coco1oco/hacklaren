// Lazy Admin SDK accessors. Lazy so pure modules (and unit tests) can import without initialising Firebase.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const DEFAULT_APP = '[DEFAULT]';

// Check for the DEFAULT app specifically: the Functions runtime/emulator may register its own named app,
// in which case `getApps().length > 0` would skip initialisation and getFirestore() would throw.
function ensureApp(): void {
  if (!getApps().some((a) => a.name === DEFAULT_APP)) initializeApp();
}

export function db(): Firestore {
  ensureApp();
  return getFirestore();
}

export function adminAuth(): Auth {
  ensureApp();
  return getAuth();
}
