# MARA — Maternal Referral and Admission

> The patient moves. Her record moves with her.

MARA is a maternal referral and patient-record continuity system for participating lying-in clinics and receiving hospitals. Midwives keep prenatal records, record visits (offline too), and send emergency or checkup referrals. Hospitals open a secure, time-limited link (no account needed), acknowledge, decline, or record arrival, and the clinic sees the status in real time.

MARA is an information-transfer tool. It does not diagnose, does not replace clinician judgment, emergency transport, hospital EMRs, or official DOH referral procedures, and it is designed to complement existing referral workflows. It is not DOH- or NPC-certified.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 PWA, Tailwind 4, React Router, React Hook Form + Zod, Recharts — hosted on **Vercel** |
| Backend | Firebase Auth, Cloud Firestore, Cloud Functions v2 (**asia-southeast1**), App Check |
| AI summary | `SummaryProvider` adapter — currently `mock` only (Amazon Q integration comes later) |
| SMS | `SmsProvider` adapter — `mock` (default) or Semaphore, server-side only |
| PDF | pdf-lib, generated server-side, returned as base64 (never a public URL) |

## Layout

```text
functions/src/shared/   Shared contracts + domain logic (frontend imports via @shared/*)
functions/src/          Cloud Functions: referrals, hospital access, PDF, SMS, AI adapter, admin, cleanup
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
cp functions/.env.example functions/.env   # AI_PROVIDER=mock, SMS_PROVIDER=mock
npm run build:functions
npx firebase emulators:start --only auth,firestore,functions --project demo-mara   # terminal 1
npx tsx scripts/seed.ts --emulator                                                 # once
npm run dev                                                                        # terminal 2
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

## Deployment

Use separate Firebase projects for development and production (`.firebaserc` aliases). Never point development at production patient data.

Firebase (per project):
1. Create the Firestore database in `asia-southeast1` (location cannot be changed later).
2. Set `functions/.env.<projectId>`: `APP_BASE_URL=https://<your-vercel-domain>` (https required; links are built from it), `REFERRAL_LINK_TTL_HOURS` (24–72), `AI_PROVIDER`, `SMS_PROVIDER`, `ENFORCE_APP_CHECK`.
3. If `SMS_PROVIDER=semaphore`: `npx firebase functions:secrets:set SEMAPHORE_API_KEY`.
4. `npx firebase use production && npx firebase deploy --only firestore,functions,storage`.
5. Add a TTL policy on `rateLimits.expiresAt`; register the Vercel domain for App Check (reCAPTCHA Enterprise) — see `docs/SECURITY.md`.

Vercel:
1. Import the repo; `vercel.json` sets the Vite build, SPA rewrites (including `/referral/:token`), and security headers.
2. Set the `VITE_FIREBASE_*` web config, `VITE_FUNCTIONS_REGION=asia-southeast1`, optional `VITE_APPCHECK_SITE_KEY`. Do **not** set `VITE_USE_EMULATORS`.
3. Add the Vercel domain to Firebase Auth → Authorized domains.

## Privacy

Built with RA 10173 (Data Privacy Act of 2012) in mind: clinic-scoped access, consent capture, audit logs, data minimisation (SMS and AI), hashed expiring revocable links. Organisational requirements (DPO, NPC registration where applicable, data-sharing agreements) are outside the code. See `docs/SECURITY.md` and `docs/DATA_RETENTION.md`. Use synthetic data only for demos.
