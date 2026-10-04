# MARA data retention and deletion policy (draft)

Status: draft for review by the deploying organisation's Data Protection Officer (DPO). MARA is designed with the Philippine Data Privacy Act (RA 10173) in mind but is not certified by, or officially integrated with, the NPC or DOH. Retention periods below must be confirmed against clinic policy and applicable law.

## Outside the code

These are organisational responsibilities, not features of MARA:

- Appointing a DPO and publishing a privacy notice to patients.
- NPC registration of the processing system, where applicable.
- Data-sharing agreements with receiving hospitals and any SMS or AI provider.
- Setting the legally required retention period for maternal health records.
- Breach-response procedures and staff privacy training.

## Retention by data type

| Data | Where | Retention | Notes |
| --- | --- | --- | --- |
| Patient records | `patients` | Per clinic policy and applicable law (to be confirmed by DPO) | Never hard-deleted by clients. Deactivate with `active = false`. |
| Prenatal visits | `patients/*/visits` | Same as the patient record | Edits are versioned (`version`, `updatedBy`, `updatedAt`). |
| Referrals | `referrals` | Same as the patient record | Part of the clinical record. |
| Referral link tokens | `referralTokens` | Until expiry/revocation plus a short grace period, then deletable by a scheduled function | Only SHA-256 hashes are stored. Link expiry is not record deletion. |
| Offline emergency queue | `referralRequests` | Until processed, then deletable after a short window (e.g. 30 days) | |
| SMS logs | `smsLogs` | Operational period agreed with the DPO (suggested 1 year) | No clinical content. |
| Audit logs | `auditLogs` | Retained, append-only, at least as long as the records they describe | No clinical content. |
| Rate-limit counters | `rateLimits` | Hours; removed by a TTL policy on `expiresAt` | |
| Referral PDFs | Not stored | Generated on demand and returned to the caller | Downloaded copies on devices are the downloader's responsibility. |
| AI summaries | Inside `referrals` | Same as the referral | Providers receive minimised context only; no provider-side retention should be permitted by contract. |
| Staff accounts | Firebase Auth + `midwives` | Kept while referenced by records | Deactivated, never deleted (`setStaffActive`). |

## Referral link expiry is not deletion

Hospital links expire after 24–72 hours or when revoked. This only ends link access. The referral, its status history, and the summary remain in the clinic's records.

## Staff deactivation

Staff who leave are deactivated, not deleted, so authorship in audit logs and records stays attributable. Deactivation disables the Auth account and should revoke refresh tokens.

## Data subject requests

Requests from a patient (or authorised representative) are handled by the clinic, coordinated by the DPO:

1. **Receive and verify**: log the request with date and channel; verify identity in person or through an approved method.
2. **Access**: a clinic_admin exports the patient's record (e.g. the patient PDF via `generateReferralPdf({ patientId })`) and hands it over securely. Record the disclosure.
3. **Correction**: clinic staff edit the patient or visit record in MARA. `updatedBy` / `updatedAt` / `version` record the latest change and an `*_edited` audit event is written; prior values are not retained (add field-level history if the organisation requires it).
4. **Objection / withdrawal of consent**: update the consent flag. New checkup referrals then require renewed consent; emergency referrals may proceed without it and are audited.
5. **Erasure / blocking**: assess against legal retention duties. If erasure is warranted, deactivate the patient (`active = false`) and have an authorised operator perform deletion server-side (Admin SDK), recording the action. There is no client delete path by design.
6. **Respond** within the period required by law and record the outcome.

## Backups

If Firestore backups or exports are enabled, they inherit these retention periods and must be stored in the same region (`asia-southeast1`) with restricted access. Deleted data persists in backups until they expire.
