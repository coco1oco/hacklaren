# MARA — Maternal Referral and Admission

> The patient moves. Her record moves with her.

MARA is a maternal referral and patient-record continuity system for participating lying-in clinics and receiving hospitals. Midwives keep prenatal records, record visits (offline too), and send emergency or checkup referrals. Hospitals open a secure, time-limited link (no account needed), acknowledge, decline, or record arrival, and the clinic sees the status in real time.

MARA is an information-transfer tool. It does not diagnose, does not replace clinician judgment, emergency transport, hospital EMRs, or official DOH referral procedures, and it is designed to complement existing referral workflows. It is not DOH- or NPC-certified.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 PWA, Tailwind 4, React Router, React Hook Form + Zod, Recharts — hosted on **Vercel** |
| Backend | Firebase Auth + Cloud Firestore (**asia-southeast1**, Spark plan) · server API on **Vercel Functions** (`/api`, region `sin1`) using the Firebase Admin SDK |
| AI summary | `SummaryProvider` adapter — currently `mock` only (Amazon Q integration comes later) |
| SMS | `SmsProvider` adapter — `mock` (default) or Semaphore, server-side only |
| PDF | pdf-lib, generated server-side, returned as base64 (never a public URL) |

## Layout

```text
functions/src/shared/   Shared contracts + domain logic (frontend imports via @shared/*)
functions/src/          Server logic: referrals, hospital access, PDF, SMS, AI adapter, admin, cleanup
functions/src/http/     Host-agnostic HTTP entry (bundled to server-dist/ for Vercel)
api/                    Vercel Functions: /api/call/<name>, /api/cron/cleanup
src/                    React PWA (staff app + public /referral/:token hospital view)
firestore.rules         Security rules (clinic isolation, RBAC, append-only audit)
tests/rules, tests/e2e  Firestore rules tests (emulator) and Playwright E2E
scripts/seed.ts         Emulator-only demo data
docs/                   SECURITY.md, DATA_RETENTION.md
```

## Local development

Prerequisites: Node 22, Java 21+ (Firebase emulators).

```bash
npm install
npm --prefix functions install
cp .env.example .env.local                 # VITE_USE_EMULATORS=true
npx firebase emulators:start --only auth,firestore --project demo-mara   # terminal 1
npm run dev:api                                                          # terminal 2 (same handlers as Vercel /api)
npx tsx scripts/seed.ts --emulator                                       # once
npm run dev                                                              # terminal 3 (proxies /api → dev:api)
```

Demo logins (emulator only, password `Password123!`): `midwife@mara.test`, `admin@mara.test`, `super@mara.test`, `midwife2@mara.test` (second clinic). Demo patient: Maria Santos, `MARA-PAT-2841`.

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | App, test, and functions TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |
| `npm run test:rules` | Firestore rules tests (starts the Firestore emulator) |
| `npm run test:e2e` | Playwright (needs emulators + seed running) |
| `npm run build` | Production PWA build |
| `npm run build:vercel` | PWA build + server bundle (`server-dist/`) — what Vercel runs |

## Deployment (Firebase Spark + Vercel)

Cloud Functions need the Blaze plan, so MARA's server code runs as Vercel Functions instead. Firebase only provides
Auth + Firestore (both free on Spark). Live project: `silang-demo` (Firestore in `asia-southeast1`).

Firebase (once):
1. Firestore rules: `npx tsx scripts/deploy-firestore.ts` (uses `.secrets/firebase-service-account.json`).
2. Composite indexes: deploy `firestore.indexes.json` with the Firebase CLI as a project Owner
   (`npx firebase login`, then `npx firebase deploy --only firestore:indexes --project silang-demo`).
3. First super admin: `npx tsx scripts/bootstrap-super-admin.ts <email> "<Name>" [password]`.
4. Auth → Settings → Authorized domains: add your Vercel domain.

Vercel:
1. Import the repo (framework: Vite). `vercel.json` sets the build (`npm run build:vercel`), `/api` functions in `sin1`,
   a daily cleanup cron, SPA rewrites, and security headers. `.env.production` holds the public Firebase web config.
2. Environment variables (Production), from `.secrets/vercel.env` (never commit): `FIREBASE_SERVICE_ACCOUNT_BASE64`,
   `CRON_SECRET`, `AI_PROVIDER`, `SMS_PROVIDER`, `REFERRAL_LINK_TTL_HOURS`, `ENFORCE_APP_CHECK`. Optional `APP_BASE_URL`
   (defaults to the Vercel production domain). Never set `VITE_USE_EMULATORS` in Vercel.

## Privacy

Built with RA 10173 (Data Privacy Act of 2012) in mind: clinic-scoped access, consent capture, audit logs, data minimisation (SMS and AI), hashed expiring revocable links. Organisational requirements (DPO, NPC registration where applicable, data-sharing agreements) are outside the code. See `docs/SECURITY.md` and `docs/DATA_RETENTION.md`. Use synthetic data only for demos.
