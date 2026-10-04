// Lazy Admin SDK accessors. Lazy so pure modules (and unit tests) can import without initialising Firebase.
//
// Credentials, in order:
//  1. FIREBASE_SERVICE_ACCOUNT_BASE64 (base64 of the service-account JSON) — Vercel / any non-Google host.
//  2. FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON) — same, for local use.
//  3. Application Default Credentials — Cloud Functions, or the emulators (FIRESTORE_EMULATOR_HOST etc.).
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getAppCheck, type AppCheck } from 'firebase-admin/app-check';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const DEFAULT_APP = '[DEFAULT]';

/** Parses the service account from env. Never logs key material. */
export function serviceAccountFromEnv(env: NodeJS.ProcessEnv = process.env): (ServiceAccount & { project_id?: string }) | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_BASE64
    ? Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    : env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as ServiceAccount & { project_id?: string };
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_* is set but is not valid service-account JSON');
  }
}

// Check for the DEFAULT app specifically: the Functions runtime/emulator may register its own named app,
// in which case `getApps().length > 0` would skip initialisation and getFirestore() would throw.
function ensureApp(): void {
  if (getApps().some((a) => a.name === DEFAULT_APP)) return;
  const sa = serviceAccountFromEnv();
  if (sa) {
    initializeApp({ credential: cert(sa), projectId: sa.project_id ?? sa.projectId });
    return;
  }
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  initializeApp(projectId ? { projectId } : undefined);
}

export function db(): Firestore {
  ensureApp();
  return getFirestore();
}

export function adminAuth(): Auth {
  ensureApp();
  return getAuth();
}

export function adminAppCheck(): AppCheck {
  ensureApp();
  return getAppCheck();
}
