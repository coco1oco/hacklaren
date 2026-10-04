// Single Firebase initialisation for the browser (Auth + Firestore only).
// Server operations go to MARA's own API (/api/call/<name>, Vercel Functions), not Cloud Functions,
// so the Firebase project can stay on the no-cost Spark plan.
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';

const env = import.meta.env;

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

const appCheck: AppCheck | null = env.VITE_APPCHECK_SITE_KEY
  ? initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true })
  : null;

export const auth = getAuth(app);

// IndexedDB persistence enables offline reads and queued offline writes (visits, patients, emergency requests).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/** Error thrown by callable(); shaped like a FirebaseError so existing error mapping (code, details) keeps working. */
export class CallableError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'CallableError';
  }
}

const API_BASE = env.VITE_API_BASE_URL?.replace(/\/+$/, '') || '';

/**
 * Typed call to a MARA server function. Use with the request/response types from @shared/contracts.
 * Sends the signed-in user's ID token (if any) and an App Check token when App Check is enabled.
 */
export function callable<Req, Res>(name: string) {
  return async (data: Req): Promise<Res> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const user = auth.currentUser;
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
    if (appCheck) {
      try {
        headers['X-Firebase-AppCheck'] = (await getToken(appCheck, false)).token;
      } catch {
        // The server decides whether a missing App Check token is acceptable.
      }
    }
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/call/${encodeURIComponent(name)}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
    } catch {
      throw new CallableError('functions/unavailable', 'No internet connection or the server is unreachable.');
    }
    const body = (await res.json().catch(() => null)) as { result?: Res; error?: { status?: string; message?: string; details?: unknown } } | null;
    if (!res.ok || !body || body.error) {
      const status = body?.error?.status ?? (res.status >= 500 ? 'internal' : 'unknown');
      throw new CallableError(`functions/${status}`, body?.error?.message ?? 'Request failed.', body?.error?.details ?? null);
    }
    return body.result as Res;
  };
}
