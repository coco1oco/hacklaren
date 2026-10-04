/**
 * Deploys firestore.rules + firestore.indexes.json to the live project using the service account
 * (works on the Spark plan and without the Service Usage permission the Firebase CLI needs).
 *
 *   npx tsx scripts/deploy-firestore.ts            (reads .secrets/firebase-service-account.json)
 *
 * Index creation is idempotent: existing indexes (HTTP 409) are skipped.
 */
import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';

const sa = JSON.parse(readFileSync(process.env.SERVICE_ACCOUNT_PATH ?? '.secrets/firebase-service-account.json', 'utf8'));
for (const k of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) delete process.env[k];
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const P = sa.project_id as string;
const BASE = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)`;

async function token(): Promise<string> {
  return (await app.options.credential!.getAccessToken()).access_token;
}

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
  return { status: res.status, json };
}

// 1. Security rules
const source = readFileSync('firestore.rules', 'utf8');
const ruleset = await getSecurityRules(app).releaseFirestoreRulesetFromSource(source);
console.log(`rules: released ruleset ${ruleset.name.split('/').pop()}`);

// 2. Composite indexes
type IndexDef = { collectionGroup: string; queryScope: string; fields: { fieldPath: string; order?: string; arrayConfig?: string }[] };
type Override = { collectionGroup: string; fieldPath: string; indexes: { order?: string; arrayConfig?: string; queryScope: string }[] };
const cfg = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as { indexes: IndexDef[]; fieldOverrides: Override[] };

for (const ix of cfg.indexes) {
  const r = await api('POST', `${BASE}/collectionGroups/${ix.collectionGroup}/indexes`, { queryScope: ix.queryScope, fields: ix.fields });
  const label = `${ix.collectionGroup}(${ix.fields.map((f) => `${f.fieldPath} ${f.order ?? f.arrayConfig}`).join(', ')})`;
  if (r.status === 200) console.log(`index: creating ${label}`);
  else if (r.status === 409) console.log(`index: exists   ${label}`);
  else console.log(`index: FAILED   ${label} → HTTP ${r.status} ${r.json.error?.status ?? ''} ${r.json.error?.message ?? ''}`);
}

// 3. Field overrides (e.g. collection-group index on visits.clinicId)
for (const o of cfg.fieldOverrides) {
  const url = `${BASE}/collectionGroups/${o.collectionGroup}/fields/${encodeURIComponent(o.fieldPath)}?updateMask=indexConfig`;
  const r = await api('PATCH', url, { indexConfig: { indexes: o.indexes.map((i) => ({ queryScope: i.queryScope, fields: [{ fieldPath: o.fieldPath, ...(i.order ? { order: i.order } : { arrayConfig: i.arrayConfig }) }] })) } });
  console.log(r.status === 200 ? `override: ${o.collectionGroup}.${o.fieldPath} updating` : `override: FAILED ${o.collectionGroup}.${o.fieldPath} → HTTP ${r.status} ${r.json.error?.message ?? ''}`);
}
