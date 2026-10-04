---
inclusion: always
---

# MARA build contract (all agents)

MARA = Maternal Referral and Admission. React + Vite + TS PWA (hosted on **Vercel**) + Firebase (Auth, Firestore, Cloud Functions in **asia-southeast1**, Storage, App Check). The product spec is the HANDOFF given by the user; the rules below are binding for every agent.

## Single source of truth

- `functions/src/shared/` is the shared domain layer. Frontend imports it via `@shared/*`; functions import it relatively.
  - `contracts.ts` — Firestore document shapes, callable names + request/response types, `SummaryContext`, `SummaryProvider`, `AI_LABELS`.
  - `types.ts`, `schemas.ts` (zod), `pregnancy.ts`, `geo.ts`, `referralStatus.ts` (state machine), `riskFlags.ts`, `ids.ts`.
- Changes to `functions/src/shared/**` are contract changes. Only make them if strictly required, keep them backwards compatible, and state them in your final report.
- `functions/src/shared/**` must stay platform-neutral (no `node:*`, `firebase*`, `react*` imports — lint enforces this).
- `functions/src/lib/token.ts` — token generation/hashing (SHA-256 hex), TTL clamp 24–72h, URL builder.

## Ownership

| Area | Owner |
| --- | --- |
| `functions/src/**` except `shared/` and `*.test.ts` (functions, repositories, services, SMS adapter, PDF, SummaryProvider + mock, cleanup), `functions/package.json`, `scripts/seed.ts` | mara-backend |
| `src/**` (React app, PWA UI, auth screens, dashboard, patients, visits, referrals, hospital view, admin, help), `index.html`, `public/**`, `vite.config.ts` | mara-frontend |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `tests/rules/**`, `vitest.rules.config.ts`, `docs/SECURITY.md`, `docs/DATA_RETENTION.md` | mara-security |
| `**/*.test.ts(x)` outside `tests/rules/`, `tests/e2e/**`, `playwright.config.ts` | mara-testing |
| `package.json`, `tsconfig*.json`, `eslint.config.js`, `firebase.json`, `vercel.json`, `.env.example`, `functions/.env.example`, `functions/src/shared/**`, `functions/src/lib/token.ts` | foundation (orchestrator) |

Do not edit files outside your area. If you need a change elsewhere, describe it in your final report instead.

## Non-negotiables

- Emergency referral: SENT immediately, link issued immediately, AI summary runs asynchronously (Firestore trigger). Never wait on AI.
- Checkup referral: CREATED → generateSummary → midwife reviews/edits → sendReferral → SENT. If AI fails, the midwife cannot send a "reviewed AI summary"; show "AI summary unavailable. Review the raw chart manually. Retry summary."
- Raw link tokens are never stored. Store SHA-256(token) as doc id in `referralTokens`. Resend = rotate token (old revoked), never a new referral doc.
- Hospital route `/referral/:token` needs no Firebase Auth; all access goes through `getReferralView` / `updateReferralStatus` / `generateReferralPdf({token})`.
- Clinic isolation enforced by Firestore rules + functions using custom claims `{ role, clinicId }`. Never trust frontend role data.
- Referral docs, tokens, smsLogs, staff docs, rate limits: written only by Cloud Functions (Admin SDK).
- No clinical data in SMS or audit logs. No diagnoses: use "Observation requires clinical review."
- Amazon Q is NOT integrated yet. Only `SummaryProvider` + `MockSummaryProvider` (selected by `AI_PROVIDER=mock`).
- SMS via `SmsProvider` adapter: `mock` (default) and `semaphore` (server-side only, secret `SEMAPHORE_API_KEY`).
- No false compliance claims (DOH certified, NPC certified, HIPAA, official DOH integration).
- Hosting: frontend on Vercel (`vercel.json`, SPA rewrite). Functions build hospital links from `APP_BASE_URL` (the Vercel URL). Callable functions must work cross-origin from the Vercel domain.

## Commands

- `npm run typecheck` (frontend tsc + functions build), `npm run lint`, `npm test` (vitest unit), `npm run build`
- `npm run test:rules` (requires Firestore emulator → Java 21+), `npm run test:e2e` (Playwright)
- Pin exact dependency versions. Windows/PowerShell environment.
