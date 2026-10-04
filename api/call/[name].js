// Vercel Function: POST /api/call/<name> → MARA callable (see functions/src/http/index.ts).
// server-dist/index.cjs is produced by `npm run build:server` during the Vercel build.
import { waitUntil } from '@vercel/functions';
import server from '../../server-dist/index.cjs';

export async function POST(request) {
  const name = decodeURIComponent(new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '');
  return server.handleCallable(name, request, { waitUntil });
}
