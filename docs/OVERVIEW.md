# MARA — Project Documentation

> **MARA — Maternal Referral and Admission**
> *"The patient moves. Her record moves with her."*

MARA is a maternal referral and patient-record continuity system that connects
participating lying-in clinics with receiving hospitals. Midwives keep prenatal
records, log visits (even offline), and send referrals; hospitals open a secure,
time-limited link — no account required — to view the record and respond. The
clinic sees every status change in real time.

This document explains the problem MARA addresses, what it does to solve it, and
how its features fit together. For deeper material see
[`SECURITY.md`](./SECURITY.md), [`DATA_RETENTION.md`](./DATA_RETENTION.md), and
the root [`README.md`](../README.md).

---

## 1. The problem

In many low-resource maternal care settings, a pregnant patient is first seen at
a small lying-in clinic by a midwife. When something goes wrong — or when a
routine checkup needs a higher level of care — she is referred to a hospital.
The referral itself is usually the weak link:

- **The record does not travel with the patient.** Prenatal history, blood type,
  allergies, danger signs, and visit trends often stay behind at the clinic. The
  receiving hospital starts almost from scratch, re-asking questions during an
  emergency when minutes matter.
- **Referrals are opaque.** Once a paper slip leaves the clinic, the midwife has
  no reliable way to know whether the hospital received it, accepted it, or
  whether the patient ever arrived.
- **Connectivity is unreliable.** Clinics may lose internet during exactly the
  moments a referral is most urgent, so a purely online tool fails when it is
  needed most.
- **Hospitals cannot be expected to onboard.** A receiving hospital will not
  create accounts or install software just to read one clinic's referral.
- **The data is highly sensitive.** Maternal health records fall under the
  Philippine Data Privacy Act (RA 10173). Any tool must minimise what it shares,
  isolate clinics from each other, and keep an audit trail.

### What MARA is *not*

MARA is deliberately scoped as an **information-transfer tool**. It does **not**:

- diagnose or replace clinician judgment,
- replace emergency transport,
- replace hospital EMR systems or official DOH referral procedures.

It is designed to *complement* existing workflows and is **not** DOH- or
NPC-certified.

---

## 2. What MARA does to solve it

MARA attacks each part of the problem with a specific, bounded capability.

| Problem | MARA's response |
| --- | --- |
| Record stays behind | A structured prenatal record + visit history travels as a token-gated hospital view and an on-demand PDF. |
| Referral status is opaque | A server-enforced state machine (`CREATED → SENT → ACKNOWLEDGED → ARRIVED`, plus `DECLINED/EXPIRED/CANCELLED`) with real-time status visible to the clinic. |
| Connectivity is unreliable | A PWA with offline Firestore persistence; visits and emergency referrals are queued locally and sync when the connection returns. |
| Hospitals won't onboard | A public `/referral/:token` link needs no account — just the URL — and expires. |
| Sensitive data | Clinic isolation via security rules, consent capture, append-only audit logs, data minimisation for SMS and AI, and hashed, expiring, revocable links. |

---

## 3. Core features

### 3.1 Patient records
- Register patients with duplicate detection (`nameLower`) and explicit
  **consent capture** for data sharing.
- Structured fields: demographics, emergency contact, blood type, allergies,
  medical and obstetric history, and pregnancy info (LMP, EDD, gravida, para).
- Optimistic concurrency: every update increments a `version`, so a stale
  offline edit is rejected on sync and surfaced as a conflict rather than
  silently overwriting newer data.

### 3.2 Prenatal visits (offline-capable)
- Midwives record vitals per visit: blood pressure, weight, fetal heart rate,
  glucose, fundal height, urine protein/glucose, medications, notes, and four
  **danger signs** (bleeding, severe headache, blurred vision, reduced fetal
  movement).
- **Input validation in three tiers** (`functions/src/shared/riskFlags.ts`):
  - *Expected ranges* — a soft warning but saving is allowed.
  - *Hard limits* — physically impossible values block saving.
  - *Review thresholds* — values that get flagged for clinical review (never a
    diagnosis).
- Visits are written through a durable outbox so they survive loss of
  connectivity.

### 3.3 Risk flags and trends (review, not diagnosis)
- `visitRiskFlags()` highlights recorded values that cross configured review
  thresholds (e.g. BP ≥ 140/90, FHR < 110 or > 160, elevated glucose, urine
  protein, any danger sign).
- `abnormalTrends()` describes documented trends neutrally (e.g. "Systolic BP
  increased across the last 3 visits").
- Every flag carries the message *"Observation requires clinical review"* — MARA
  never states a diagnosis.

### 3.4 Referrals
Two types, each with its own workflow:

**Emergency referral**
- Created in `SENT` state **immediately** — it never waits on anything.
- Issues the hospital link and sends SMS right away.
- The AI summary is generated **asynchronously** afterward and labelled as
  produced after transmission, so it never blocks the urgent send.
- Can be **queued offline** (`referralRequests`): the client writes the request
  while offline; once it syncs, a trigger (or the `processReferralRequest`
  callable) turns it into a real referral and sends the link.
- May proceed without consent in an emergency — this is audited.

**Checkup referral**
- Created in `CREATED` state.
- An AI summary is generated and must be **reviewed/edited and approved by the
  midwife** before `sendReferral` issues the link (a review gate).
- The approved (possibly edited) summary is what the hospital sees.

A server-side state machine (`referralStatus.ts`) governs every transition and
*who* may perform it:
- Hospitals may `ACKNOWLEDGED`, `DECLINED` (checkup only), or `ARRIVED`.
- Checkup patients must be acknowledged before arrival; emergencies may arrive
  first.
- Terminal states (`ARRIVED`, `DECLINED`, `EXPIRED`, `CANCELLED`) are final.

### 3.5 Token-gated hospital view
- Receiving hospitals open `/referral/:token` with **no Firebase Auth**.
- The view is a completely separate code path from the staff app (its own chunk,
  no admin/staff code, no auth providers).
- Tokens are 256-bit, stored only as a SHA-256 hash, expire in 24–72h (default
  48h), and are **revocable** and **rotatable** (resend issues a new token on the
  same referral).
- Access is **rate-limited** per IP and per invalid-attempt, with App Check as
  defence in depth.
- Hospitals can acknowledge, decline, or record arrival, and download a PDF — all
  via the token.

### 3.6 AI summary (data-minimised)
- A `SummaryProvider` adapter produces a structured summary (`summary`,
  `keyFindings`, `riskFlags`, `medications`, `reasonForReferral`,
  `abnormalTrends`).
- The provider receives a **minimised `SummaryContext`** — no name, patient id,
  contact numbers, address, emergency contacts, or birthdate (age in years only).
- Output is always labelled **AI-GENERATED** and never presented as a diagnosis.
- Only `MockSummaryProvider` exists today; an Amazon Q integration is deferred and
  would require a data-processing review first.

### 3.7 SMS notifications (data-minimised)
- A `SmsProvider` adapter (`mock` default, or Semaphore) sends links and status
  alerts server-side only.
- Messages contain **no clinical data** — only clinic/hospital names, a referral
  id or link, and contact numbers.
- `smsLogs` store a masked recipient alongside the full number for retry, readable
  only by own-clinic staff.

### 3.8 PDF export
- `generateReferralPdf` builds the referral/patient PDF **server-side** with
  `pdf-lib` and returns it as base64.
- It is **never stored at a public URL**; downloaded copies are the downloader's
  responsibility.
- Callable by clinic staff (`referralId` or `patientId`) or by a hospital
  (`token`).

### 3.9 Administration and reporting
- **Staff**: `createStaffUser` / `setStaffActive` — the only way accounts are
  created (no self-registration). Staff are deactivated, never deleted, to keep
  audit authorship intact.
- **Clinic self-registration**: `registerClinic` lets a new signed-in user create
  a clinic and become its `clinic_admin` owner.
- **Reporting**: `getReferralReport` returns **aggregate counts only** (per
  clinic/status/type over a date range) so a super admin never reads referral
  documents, names, free text, or phone numbers.
- Admin pages: hub, staff, clinics, hospitals, reports.

### 3.10 Audit logs
- `auditLogs` is **append-only** (no client update/delete) and never contains
  clinical content — only ids, actor, time, and small non-clinical metadata.
- A small set of actions is client-writable; everything authoritative is
  server-written.

---

## 4. Roles and access

| Role | Scope |
| --- | --- |
| `midwife` | Read/create/update patients, visits, and referrals of their own clinic. |
| `clinic_admin` | Clinic owner — everything a midwife can do, plus manage own-clinic midwives, edit clinic contact fields, and run own-clinic reports. |
| `super_admin` | No clinic and **no access to patient/referral/SMS documents**; manages clinics and hospitals and reads **aggregate counts only**. |
| *(hospital, unauthenticated)* | Token-only access to a single referral view. |

Authorization relies solely on ID-token custom claims (`role`, `clinicId`) set
server-side. Frontend role data is display-only and never trusted. See the full
RBAC matrix in [`SECURITY.md`](./SECURITY.md#2-rbac-matrix-firestore-client-access).

---

## 5. Architecture

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

### 5.1 Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 8 PWA, Tailwind 4, React Router, React Hook Form + Zod, Recharts — hosted on **Vercel** |
| Backend | Firebase Auth + Cloud Firestore (**asia-southeast1**, Spark plan); server API on **Vercel Functions** (`/api`, region `sin1`) using the Firebase Admin SDK |
| AI summary | `SummaryProvider` adapter — currently `mock` only |
| SMS | `SmsProvider` adapter — `mock` (default) or Semaphore, server-side only |
| PDF | `pdf-lib`, generated server-side, returned as base64 |

### 5.2 Why Vercel + Firebase Spark

Cloud Functions require Firebase's paid Blaze plan. To stay on the free Spark
plan, MARA runs its **server code as Vercel Functions** instead, using the
Firebase Admin SDK. Firebase provides only **Auth + Firestore** (both free on
Spark). This is also why the offline emergency queue offers a
`processReferralRequest` callable: Firestore triggers aren't available in this
setup, so the client can drive processing where a trigger would otherwise fire.

### 5.3 The shared contract

`functions/src/shared/contracts.ts` is the single source of truth shared by the
frontend, backend, security rules, and tests. It defines Firestore document
shapes, every callable's request/response payload, and the AI summary interface.
Changing it is a cross-team change: rules, functions, UI, and tests move
together.

### 5.4 Request flow (frontend → server)

The React app does not talk to Cloud Functions directly. Callables are invoked
through `/api/call/<name>` Vercel Functions, which run the same handlers bundled
to `server-dist/`. A daily `/api/cron/cleanup` job handles maintenance (e.g.
expiring referrals, pruning tokens).

---

## 6. Data model (collections)

| Collection | Purpose |
| --- | --- |
| `clinics` | Clinic profile, contacts, and emergency SMS recipients (BHW/MHO). |
| `midwives` | One profile per staff user (all roles). Written by server only. |
| `patients` | Patient record; doc id is client-generated; versioned. |
| `patients/*/visits` | Prenatal visits (subcollection), versioned, denormalised `clinicId`. |
| `referrals` | Referral document; clients may read own clinic, **all writes via server**. |
| `hospitals` | Receiving hospitals (level, services, geo, DOH-networked). |
| `auditLogs` | Append-only audit trail; no clinical content. |
| `smsLogs` | Server-written SMS log; masked recipients; no clinical content. |
| `referralTokens` | **Server-only.** Doc id = SHA-256(raw token). Never client-readable. |
| `referralRequests` | Client create-only offline queue for emergency referrals. |
| `rateLimits` | Server-only rate-limit counters (TTL-expired). |

---

## 7. Security and privacy highlights

MARA is built with RA 10173 (Data Privacy Act of 2012) in mind. Key technical
controls:

- **Clinic isolation** keyed on server-set custom claims; every clinical document
  carries a denormalised `clinicId` compared against the claim.
- **super_admin has no clinical read access** — only aggregate counts.
- **Referral docs are server-write-only**; the state machine prevents forged
  status changes (e.g. a fake "ARRIVED").
- **Record integrity**: creates/updates must match `auth.uid`, server time, and a
  monotonically increasing `version`.
- **Hashed, expiring, revocable, rotatable** hospital links with rate limiting.
- **Data minimisation** for SMS (no clinical data) and AI (no identifiers).
- **Append-only audit logs**; secrets kept out of the browser bundle (the SMS key
  is a Firebase secret).

Organisational requirements (DPO appointment, NPC registration where applicable,
data-sharing agreements) are outside the code. Use **synthetic data only** for
demos. Full details: [`SECURITY.md`](./SECURITY.md) and
[`DATA_RETENTION.md`](./DATA_RETENTION.md).

---

## 8. Development and quality

| Command | What it runs |
| --- | --- |
| `npm run dev` | Local PWA dev server (proxies `/api`). |
| `npm run dev:api` | Local API, the same handlers Vercel runs. |
| `npm run typecheck` | App, test, and functions TypeScript. |
| `npm run lint` | ESLint. |
| `npm test` | Vitest unit tests. |
| `npm run test:rules` | Firestore rules tests (starts the Firestore emulator). |
| `npm run test:e2e` | Playwright E2E (needs emulators + seed). |
| `npm run build` | Production PWA build. |
| `npm run build:vercel` | PWA build + server bundle (`server-dist/`) — what Vercel runs. |

Prerequisites for local development: Node 22 and Java 21+ (Firebase emulators).
The domain logic in `functions/src/shared/` is covered by unit tests
(`contracts`, `geo`, `pregnancy`, `referralStatus`, `riskFlags`, `schemas`), and
security is covered by dedicated Firestore rules tests.

---

## 9. Deployment summary

- **Firebase (once):** deploy Firestore rules and composite indexes, bootstrap the
  first super admin, and add the Vercel domain to Auth authorized domains.
  Firestore must be created in `asia-southeast1` (region is permanent).
- **Vercel:** import the repo (framework: Vite). `vercel.json` sets the build,
  `/api` functions in `sin1`, a daily cleanup cron, SPA rewrites, and security
  headers. Secrets (`FIREBASE_SERVICE_ACCOUNT_BASE64`, `CRON_SECRET`, provider
  flags, link TTL, App Check enforcement) are set as Vercel environment variables
  and never committed. `VITE_USE_EMULATORS` is never set in Vercel.

See the root [`README.md`](../README.md) for the full step-by-step deployment
checklist.

---

*MARA is an information-transfer tool that complements existing referral
workflows. It does not diagnose, does not replace clinician judgment, emergency
transport, hospital EMRs, or official DOH procedures, and is not DOH- or
NPC-certified.*
