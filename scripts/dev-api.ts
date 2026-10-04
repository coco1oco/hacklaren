/**
 * Local stand-in for the Vercel /api functions, running the exact same handlers (functions/src/http) against the
 * Firebase emulators. Vite proxies /api → this server in dev.
 *
 *   npx tsx scripts/dev-api.ts            (emulators: Auth 9099 + Firestore 8080)
 */
import { createServer } from 'node:http';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.GCLOUD_PROJECT ??= 'demo-mara';
process.env.FUNCTIONS_EMULATOR ??= 'true'; // allows http://localhost hospital links in dev only
process.env.AI_PROVIDER ??= 'mock';
process.env.SMS_PROVIDER ??= 'mock';
process.env.CRON_SECRET ??= 'dev-cron-secret';
// Never let the dev server pick up production credentials.
delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

const PORT = Number(process.env.DEV_API_PORT ?? 8787);
const { handleCallable, handleCron } = await import('../functions/src/http/index');

createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    headers.set('x-real-ip', req.socket.remoteAddress ?? '127.0.0.1');
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const request = new Request(url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks) });
    const pending: Promise<unknown>[] = [];
    const parts = url.pathname.split('/').filter(Boolean);
    const response =
      parts[0] === 'api' && parts[1] === 'call' && parts[2]
        ? await handleCallable(decodeURIComponent(parts[2]), request, { waitUntil: (p) => pending.push(p) })
        : parts[0] === 'api' && parts[1] === 'cron' && parts[2] === 'cleanup'
          ? await handleCron(request)
          : new Response('Not found', { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('dev-api error', err);
    res.writeHead(500).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`MARA dev API on http://127.0.0.1:${PORT} (emulators)`));
