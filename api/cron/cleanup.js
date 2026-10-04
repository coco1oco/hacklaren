// Vercel Cron: daily maintenance (expire links, fail stale summaries, sweep pending emergency work, prune rate limits).
// Vercel sends Authorization: Bearer $CRON_SECRET automatically when CRON_SECRET is set.
import server from '../../server-dist/index.cjs';

export async function GET(request) {
  return server.handleCron(request);
}
