# MARA security design

MARA handles maternal health records. It is designed with the Philippine Data Privacy Act (RA 10173) in mind. MARA is not certified by, or officially integrated with, the DOH, the NPC, or any other body, and does not claim HIPAA or any other compliance. Organisational obligations (DPO appointment, NPC registration where applicable, data-sharing agreements with hospitals, staff training) are outside the code — see [DATA_RETENTION.md](./DATA_RETENTION.md).

## 1. Threat model (summary)

| Asset | Threat | Primary controls |
| --- | --- | --- |
| Patient charts, visits, referrals, SMS logs | Cross-clinic access; insider browsing; super_admin over-reach; deactivated staff | Firestore rules keyed on custom claims `{ role, clinicId }`; super_admin has no patient/referral/SMS-log access (aggregate counts only via `getReferralReport`); writes require an active staff profile; client audit events |
| Referral (hospital) links | Link guessing, leakage via SMS/forwarding, replay after expiry | 256-bit tokens, SHA-256 hash at rest, 24–72h TTL, revocation, rotation on resend, rate limiting |
| Referral state | Forged status changes (fake "ARRIVED"), tampering with summaries | Referral docs writable only by Cloud Functions; server-side state machine (`canTransition`) |
| Clinical record integrity | Spoofed author / timestamp, stale offline overwrites | Rules require `createdBy/updatedBy == auth.uid`, `== request.time`, `version == previous + 1` |
| Role / clinic membership | Self-promotion, editing own claims | Claims set only by Cloud Functions (Admin SDK); `midwives/*` client-write denied |
| Third parties (SMS, AI) | Over-sharing clinical data | SMS bodies contain no clinical data; AI receives minimised `SummaryContext` with no identifiers |
| Secrets | API keys in the browser bundle | SMS key is a Firebase secret; Vercel only holds public `VITE_` Firebase config |
| Abuse / cost | Automated hammering of the unauthenticated hospital endpoints | Per-IP + invalid-attempt rate limits, App Check (defence in depth) |

## 2. RBAC matrix (Firestore client access)

`own` = document `clinicId` equals the caller's `clinicId` claim. "CF" = Cloud Functions only (Admin SDK).

| Collection | midwife | clinic_admin | super_admin | unauthenticated |
| --- | --- | --- | --- | --- |
| `clinics` | read own | read own; update own contact/location fields | read/create/update all (no delete) | — |
| `midwives` (staff profiles) | read own clinic | read own clinic | read all | — |
| `patients` | read/create/update own | read/create/update own | **none** | — |
| `patients/*/visits` (+ collection group) | read/create/update own | read/create/update own | **none** | — |
| `referrals` | read own | read own | **none** (counts via `getReferralReport`) | — |
| `hospitals` | read | read | read/create/update (no delete) | — |
| `auditLogs` | create allowed client actions | read own; create allowed client actions | read all | — |
| `smsLogs` | read own | read own | **none** | — |
| `referralRequests` | create (queue), read own clinic | create, read own clinic | — | — |
| `referralTokens`, `rateLimits` | — | — | — | — |

Writes not listed are denied. No client may delete any document. All client writes to `patients`, `visits`, `referralRequests`, and `auditLogs` additionally require an active staff profile (`midwives/{uid}.active == true`, see §3). Staff accounts and claims are managed by `createStaffUser` / `setStaffActive` (clinic_admin: own-clinic midwives only; super_admin: any).

super_admin has no client read access to referral documents (reason text, AI summaries, decline reasons, `patientName`) or `smsLogs` (recipient phone numbers). System-level reports come from the `getReferralReport` callable, which requires the `super_admin` claim, runs server-side, and returns aggregate counts only (e.g. per clinic / status / type over a date range). It never returns referral ids, patient identifiers, names, free text, or phone numbers.

## 3. Clinic isolation

- Authorization uses only the ID-token custom claims `role` and `clinicId`, set server-side. Frontend role data is display-only and never trusted.
- Every client-readable clinical document carries a denormalised `clinicId`. Rules compare it to the claim. Visits are also checked against the parent patient's `clinicId`, and `clinicId` / `patientId` are immutable after creation.
- Queries must be constrained to the caller's clinic (`where('clinicId', '==', claim.clinicId)`), otherwise Firestore rejects the whole query.
- The collection-group rule (`/{path=**}/visits/{visitId}`) grants read only. Writes are governed exclusively by the nested `patients/{id}/visits/{id}` rule.
- Cloud Functions re-check role and clinic for every callable; the Admin SDK bypasses rules, so functions must never trust request fields such as `clinicId`.
- Claims are cached in ID tokens for up to 1 hour. `setStaffActive(false)` disables the Auth user, clears custom claims, revokes refresh tokens, and sets `midwives/{uid}.active = false`.
- Write rules for `patients` (create/update), `visits` (create/update), `referralRequests` (create), and `auditLogs` (create) also require `isActiveStaff()`: the caller's `midwives/{uid}` profile must exist with `active == true`. A deactivated user's still-valid ID token therefore cannot write anything immediately after deactivation.
- Residual read window: read rules rely on claims only (to avoid an extra `get()` per document read and per query). A deactivated user can keep **reading** own-clinic data until their current ID token expires (≤ 1 hour). Callables re-check the staff profile server-side.

## 4. Client-written record integrity

- Creates require `createdBy == updatedBy == auth.uid`, `createdAt == updatedAt == request.time` (i.e. `serverTimestamp()`), and `version == 1`.
- Updates require `version == resource.version + 1`, `updatedBy == auth.uid`, `updatedAt == request.time`, and unchanged `clinicId`, `patientId`, `createdAt`, `createdBy` (and `visitId`, `createdByName` for visits). A stale offline edit based on an older version is rejected on sync; the UI must surface this as a conflict.
- Patient consent changes must be re-captured: `consent.capturedBy == auth.uid` and `consent.capturedAt == request.time`.
- Rules enforce key allow-lists and basic types plus the physical hard limits for vitals (BP 30–300 / 10–200, systolic > diastolic, weight 20–300 kg, FHR 30–260, glucose 10–1000 mg/dL, fundal height 1–60 cm). Full validation (zod) also runs on the client and in functions.

## 5. Hospital referral link tokens

- Token: 32 bytes from a CSPRNG (`crypto.randomBytes`), base64url-encoded (43 characters, 256 bits of entropy).
- Storage: only `SHA-256(token)` (hex) is stored, as the document id in `referralTokens`. The raw token appears only in the URL returned once to the midwife and in the SMS to the hospital. A database leak does not yield usable links.
- Lifetime: 24–72 hours (configuration is clamped to that window; default 48h). Link expiry does not delete the referral record.
- Revocation: `revokeReferralLink`, `cancelReferral`, and terminal states revoke the token. Revoked/expired tokens return a generic `expired` / `revoked` / `invalid` result without revealing referral details.
- Rotation: `resendReferralLink` revokes the old token and issues a new one on the same referral (never a new referral document).
- Access: `/referral/:token` needs no Firebase Auth. All access goes through `getReferralView`, `updateReferralStatus`, and `generateReferralPdf({ token })`; `referralTokens` has no client access at all.
- Rate limiting: per-IP request bucket plus a separate invalid-token-attempt bucket stored in `rateLimits` (server-only). Exceeding either returns `rate_limited`.
- App Check: defence in depth against scripted abuse, **not** authorization. A valid App Check token never grants data access by itself.
- Residual: anyone holding the URL can view the referral until expiry/revocation. Hospitals should treat referral SMS as confidential; midwives can revoke or rotate at any time.

## 6. Audit events

`auditLogs` is append-only (no client update/delete). Entries never contain clinical content — only ids, actor, time, and small non-clinical `details` (server-written entries only; client entries must have empty `details`).

- Client-writable (active staff, own uid, own clinic, `at == request.time`, `details == {}`, and a non-null `patientId` must be an existing patient of the caller's clinic): `patient_viewed`, `patient_created`, `patient_edited`, `visit_created`, `visit_edited`.
- Server-only: `referral_created`, `referral_viewed`, `referral_sent`, `referral_acknowledged`, `referral_declined`, `patient_arrived`, `referral_cancelled`, `referral_expired`, `summary_generated`, `summary_failed`, `summary_approved`, `pdf_generated`, `pdf_downloaded`, `referral_link_revoked`, `referral_link_resent`, `sms_sent`, `sms_failed`, `staff_created`, `staff_deactivated`, `staff_reactivated`.

Client audit writes are best-effort (an attacker controlling their own client can skip them); server-side events are authoritative.

## 7. Data minimisation: SMS and AI

- SMS: messages contain only the clinic/hospital name, a referral id or link, and contact numbers. No diagnoses, vitals, or clinical notes. `smsLogs` store masked recipients alongside the full number for retry and are readable only by own-clinic staff (not super_admin). Provider: `mock` (default) or `semaphore` (server-side only).
- AI summaries: providers receive `SummaryContext` only — no name, patientId, contact numbers, address, emergency contacts, or birthdate (age in years only). Output is labelled AI-generated, is never a diagnosis, and uses "Observation requires clinical review." for flagged findings. Only `MockSummaryProvider` exists today; any real provider requires a data-processing review before enablement.
- Emergency referrals never wait on AI; the summary is generated asynchronously and labelled as produced after transmission.

## 8. Storage policy

`storage.rules` denies all client reads and writes. Referral PDFs are generated on demand by `generateReferralPdf` and returned as base64; they are not persisted at any URL. A commented, clinic-scoped template exists for future attachments and must be reviewed before enabling.

## 9. Secrets and configuration

- `SEMAPHORE_API_KEY`: Firebase Functions secret (`firebase functions:secrets:set SEMAPHORE_API_KEY`). Never in the repo, Vercel, or the browser bundle.
- Vercel holds only the public `VITE_FIREBASE_*` web config and the App Check site key. These identify the project; they are not secrets, and security relies on rules + functions.
- `APP_BASE_URL` (the Vercel URL) is a functions parameter used to build hospital links.
- `.env*` files with real values must never be committed.

## 10. Deployment checklist

1. **Separate projects** for dev/staging and production. Never seed demo data into production. Emulators use the `demo-mara` project id.
2. **Firestore location**: choose `asia-southeast1` when creating the database. It cannot be changed afterwards.
3. **Deploy rules and indexes**: `firebase deploy --only firestore:rules,firestore:indexes,storage`.
4. **TTL policy**: in the Google Cloud console (Firestore → TTL), create a TTL policy on collection group `rateLimits`, field `expiresAt`. TTL policies cannot be declared in `firestore.indexes.json`. TTL deletion is asynchronous (typically within 24h), so functions must still check `expiresAt` themselves.
5. **App Check**:
   - Create a reCAPTCHA Enterprise key for the Vercel production domain (and preview domains if used).
   - Register the web app with the reCAPTCHA Enterprise provider in Firebase Console → App Check.
   - Set the site key in Vercel (`VITE_` variable) and initialise App Check in the client.
   - Monitor metrics, then set `ENFORCE_APP_CHECK=true` for callables and enable enforcement for Firestore.
   - Use debug tokens only in development, never in production builds.
6. **CORS**: callables must accept the Vercel production origin. Do not use wildcard origins for any non-callable HTTP endpoint.
7. **Auth**: email/password only for staff; disable self-sign-up paths in the UI; consider enabling MFA for clinic_admin and super_admin.

## 11. Client device and offline cache

- Firestore offline persistence stores clinic data on the device. Logout must terminate Firestore and clear IndexedDB persistence (`terminate()` then `clearIndexedDbPersistence()`), and clear any app caches holding patient data.
- Shared devices should use separate staff accounts; the service worker must not cache callable responses (hospital views, PDFs).
- Offline emergency requests are queued in `referralRequests`; rules allow only `queued` creates for the caller's own clinic and patient. The trigger re-validates everything server-side.

## 12. Known residual risks

- Bearer-link model: anyone with a valid hospital URL can view the referral until expiry/revocation.
- Claim staleness: a deactivated user keeps own-clinic **read** access for up to 1 hour (until ID-token expiry); writes are blocked immediately by `isActiveStaff()` (see §3).
- Client-side audit events can be suppressed by a malicious client.
- Data on lost/stolen devices is only as safe as the device lock and logout hygiene.
- Rules cannot validate every list element or free-text content; server and client validation cover the rest.
- `nameLower` is checked with the rules `lower()` function; unusual Unicode could differ from JavaScript `toLowerCase()` and be rejected.
- Rate limits are per-IP; carrier-grade NAT can group many users, and distributed attackers can spread requests.
