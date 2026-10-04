/**
 * MARA data contracts — THE single source of truth shared by frontend, backend, security rules, and tests.
 *
 * 1. Firestore document shapes (what lives in each collection)
 * 2. Callable Cloud Function names + request/response payloads
 * 3. The minimised AI summary context and SummaryProvider interface
 *
 * Changing anything here is a cross-team contract change: update rules, functions, UI, and tests together.
 */
import type {
  BloodType,
  EmergencyContact,
  HospitalService,
  PregnancyInfo,
  QSummaryContent,
  ReferralReason,
  ReferralStatus,
  ReferralType,
  Role,
  StatusActor,
  SummaryState,
  VisitClinical,
  AuditAction,
} from './types';
import type { EmergencyReferralInput, CheckupReferralInput, ClinicRegistrationInput } from './schemas';
import type { HospitalAction } from './referralStatus';

/** Satisfied by both firebase/firestore Timestamp and firebase-admin Timestamp. */
export interface TimestampLike {
  toMillis(): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. FIRESTORE COLLECTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const COLLECTIONS = {
  clinics: 'clinics',
  midwives: 'midwives',
  patients: 'patients',
  visits: 'visits', // subcollection: patients/{patientId}/visits/{visitId}
  referrals: 'referrals',
  hospitals: 'hospitals',
  auditLogs: 'auditLogs',
  smsLogs: 'smsLogs',
  /** Server-only. Doc id = SHA-256(rawToken) hex. Never readable by clients. */
  referralTokens: 'referralTokens',
  /** Client create-only offline queue for emergency referrals. Doc id = clientRequestId. */
  referralRequests: 'referralRequests',
  /** Server-only rate-limit counters. */
  rateLimits: 'rateLimits',
} as const;

/** Custom claims set by Cloud Functions (never by the client). super_admin has clinicId null. */
export interface MaraClaims {
  role: Role;
  clinicId: string | null;
}

/** clinics/{clinicId} — writable by super_admin; clinic_admin may edit contact fields of own clinic. */
export interface ClinicDoc {
  name: string;
  address: string;
  barangay: string;
  city: string;
  province: string;
  contactNumber: string;
  latitude: number | null;
  longitude: number | null;
  /** Emergency SMS recipients (Barangay Health Worker / Municipal Health Office). */
  bhwContactNumber: string | null;
  mhoContactNumber: string | null;
  active: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

/** midwives/{uid} — one profile per staff user (all roles). Written by Cloud Functions only. */
export interface StaffDoc {
  uid: string;
  name: string;
  email: string;
  contactNumber: string;
  clinicId: string | null;
  role: Role;
  active: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface ConsentRecord {
  dataSharingForReferral: boolean;
  capturedAt: TimestampLike;
  capturedBy: string; // uid
}

/**
 * patients/{patientId} — doc id === patientId (client-generated, see ids.ts).
 * Optimistic concurrency: every update must set version = previous version + 1 (enforced by rules).
 */
export interface PatientDoc {
  patientId: string;
  name: string;
  /** Lower-cased name for search / duplicate detection. */
  nameLower: string;
  birthdate: string;
  address: string;
  barangay: string;
  contactNumber: string;
  emergencyContact: EmergencyContact;
  pregnancy: PregnancyInfo;
  allergies: string[];
  bloodType: BloodType;
  medicalHistory: string[];
  obstetricHistory: string[];
  consent: ConsentRecord;
  clinicId: string;
  active: boolean;
  version: number;
  createdAt: TimestampLike;
  createdBy: string;
  updatedAt: TimestampLike;
  updatedBy: string;
}

/** patients/{patientId}/visits/{visitId}. clinicId/patientId are denormalised for rules + collection-group queries. */
export interface VisitDoc extends VisitClinical {
  visitId: string;
  patientId: string;
  clinicId: string;
  createdAt: TimestampLike;
  createdBy: string;
  createdByName: string;
  version: number;
  updatedAt: TimestampLike;
  updatedBy: string;
}

/** hospitals/{hospitalId} — read: any signed-in staff; write: super_admin. */
export interface HospitalDoc {
  name: string;
  address: string;
  phone: string;
  referralLevel: 1 | 2 | 3;
  services: HospitalService[];
  latitude: number;
  longitude: number;
  dohNetworked: boolean;
  active: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface StatusHistoryEntry {
  status: ReferralStatus;
  at: TimestampLike;
  actor: StatusActor;
  uid: string | null;
  note: string | null;
}

export interface ReferralSummary {
  state: SummaryState;
  provider: string | null;
  /** Raw AI output (validated structure). */
  content: QSummaryContent | null;
  /** Checkup: midwife-reviewed/edited version that is shown to the hospital. */
  approvedContent: QSummaryContent | null;
  edited: boolean;
  generatedAt: TimestampLike | null;
  /** When the current generation attempt started. A 'generating' state older than SUMMARY_STALE_MS is treated as failed. */
  startedAt?: TimestampLike | null;
  approvedAt: TimestampLike | null;
  approvedBy: string | null;
  error: string | null;
  attempts: number;
}

export interface ReferralLinkState {
  expiresAt: TimestampLike | null;
  revoked: boolean;
  issuedAt: TimestampLike | null;
  /** Number of tokens issued (1 = original link; >1 = resent/rotated). */
  issueCount: number;
}

/** referrals/{referralId} — clients may READ (own clinic); ALL writes go through Cloud Functions. */
export interface ReferralDoc {
  referralId: string;
  type: ReferralType;
  status: ReferralStatus;
  statusHistory: StatusHistoryEntry[];
  patientId: string;
  patientName: string;
  clinicId: string;
  hospitalId: string;
  hospital: { name: string; phone: string; address: string };
  clinic: { name: string; contactNumber: string; address: string };
  midwife: { uid: string; name: string; contactNumber: string };
  reason: ReferralReason;
  urgency: 'emergency' | 'routine';
  summary: ReferralSummary;
  link: ReferralLinkState;
  declineReason: string | null;
  cancelReason: string | null;
  /** Consent status at the moment of referral. Emergency referrals may proceed without it (audited). */
  consentAtReferral: boolean;
  clientRequestId: string;
  createdAt: TimestampLike;
  createdBy: string;
  updatedAt: TimestampLike;
  sentAt: TimestampLike | null;
  acknowledgedAt: TimestampLike | null;
  declinedAt: TimestampLike | null;
  arrivedAt: TimestampLike | null;
  cancelledAt: TimestampLike | null;
  expiredAt: TimestampLike | null;
}

/** referralTokens/{sha256Hex} — server-only. */
export interface ReferralTokenDoc {
  referralId: string;
  clinicId: string;
  expiresAt: TimestampLike;
  revoked: boolean;
  createdAt: TimestampLike;
  revokedAt: TimestampLike | null;
}

/**
 * referralRequests/{clientRequestId} — offline emergency queue.
 * The client creates this doc (works offline via Firestore persistence). A Firestore trigger
 * turns it into a real referral once it syncs, then SMSes the hospital link to the hospital + midwife.
 */
export interface ReferralRequestDoc extends EmergencyReferralInput {
  type: 'emergency';
  clinicId: string;
  createdBy: string;
  createdAt: TimestampLike;
  state: 'queued' | 'processed' | 'failed';
  referralId: string | null;
  error: string | null;
  processedAt: TimestampLike | null;
}

export type AuditActorKind = 'user' | 'hospital_link' | 'system';

/**
 * auditLogs/{id} — append-only. Never contains clinical content.
 * Clients may only create CLIENT_AUDIT_ACTIONS for their own uid/clinic; everything else is server-written.
 */
export interface AuditLogDoc {
  action: AuditAction;
  actorKind: AuditActorKind;
  actorUid: string | null;
  actorRole: Role | null;
  clinicId: string | null;
  patientId: string | null;
  referralId: string | null;
  at: TimestampLike;
  /** Small, non-clinical metadata only (e.g. { channel: 'sms', recipientRole: 'patient' }). */
  details: Record<string, string | number | boolean | null>;
}

export type SmsRecipientRole = 'patient' | 'midwife' | 'bhw' | 'mho' | 'hospital';
export type SmsMessageType =
  | 'patient_referral_created'
  | 'emergency_alert_bhw'
  | 'emergency_alert_mho'
  | 'hospital_referral_link'
  | 'midwife_referral_link'
  | 'midwife_status_acknowledged'
  | 'midwife_status_declined';
export type SmsStatus = 'queued' | 'sent' | 'delivered' | 'failed';

/** smsLogs/{smsId} — server-written; clinic staff may read own clinic. Message bodies never contain clinical data. */
export interface SmsLogDoc {
  recipient: string;
  recipientMasked: string;
  recipientRole: SmsRecipientRole;
  messageType: SmsMessageType;
  message: string;
  referralId: string;
  clinicId: string;
  provider: 'mock' | 'semaphore';
  status: SmsStatus;
  providerMessageId: string | null;
  createdAt: TimestampLike;
  sentAt: TimestampLike | null;
  deliveredAt: TimestampLike | null;
  failedAt: TimestampLike | null;
  error: string | null;
  retryCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CALLABLE CLOUD FUNCTIONS (region asia-southeast1)
// ─────────────────────────────────────────────────────────────────────────────

export const FUNCTIONS_REGION = 'asia-southeast1';

export const CALLABLES = {
  createReferral: 'createReferral',
  generateSummary: 'generateSummary',
  sendReferral: 'sendReferral',
  getReferralView: 'getReferralView',
  updateReferralStatus: 'updateReferralStatus',
  cancelReferral: 'cancelReferral',
  revokeReferralLink: 'revokeReferralLink',
  resendReferralLink: 'resendReferralLink',
  resendSms: 'resendSms',
  generateReferralPdf: 'generateReferralPdf',
  createStaffUser: 'createStaffUser',
  setStaffActive: 'setStaffActive',
  getReferralReport: 'getReferralReport',
  registerClinic: 'registerClinic',
  processReferralRequest: 'processReferralRequest',
} as const;

/** A summary stuck in 'generating' longer than this (instance crash/timeout) is treated as failed and may be retried. */
export const SUMMARY_STALE_MS = 3 * 60_000;

export interface ReferralLinkResult {
  /** Full URL containing the raw token. Shown ONCE to the midwife; the raw token is never stored. */
  url: string;
  expiresAtMillis: number;
}

// createReferral — auth: midwife/clinic_admin of the patient's clinic.
// emergency: creates SENT immediately + link + SMS; AI summary runs afterwards (never blocks).
// checkup:   creates CREATED; no link until sendReferral.
// Idempotent on clientRequestId: repeating a request returns the existing referral (deduplicated=true, link=null).
export type CreateReferralRequest = ({ type: 'emergency' } & EmergencyReferralInput) | ({ type: 'checkup' } & CheckupReferralInput);
export interface CreateReferralResponse {
  referralId: string;
  status: ReferralStatus;
  link: ReferralLinkResult | null;
  deduplicated: boolean;
}

// generateSummary — auth: clinic staff. Checkup referrals in CREATED state (re-runnable for retry).
export interface GenerateSummaryRequest {
  referralId: string;
}
export type GenerateSummaryResponse =
  | { ok: true; state: 'ready'; content: QSummaryContent; provider: string }
  | { ok: false; state: 'failed'; error: string };

// sendReferral — auth: clinic staff. Checkup only; requires summary state 'ready' or 'approved'.
// The approved (possibly edited) summary is validated and stored as approvedContent.
export interface SendReferralRequest {
  referralId: string;
  approvedSummary: QSummaryContent;
}
export interface SendReferralResponse {
  referralId: string;
  status: 'SENT';
  link: ReferralLinkResult;
}

// getReferralView — NO Firebase Auth. Token-validated + rate-limited.
export interface GetReferralViewRequest {
  token: string;
}

export interface HospitalVisitView extends VisitClinical {
  visitId: string;
  recordedBy: string;
  gestationalAge: string;
}

export interface HospitalReferralView {
  referral: {
    referralId: string;
    type: ReferralType;
    status: ReferralStatus;
    statusHistory: { status: ReferralStatus; atMillis: number; actor: StatusActor }[];
    reason: ReferralReason;
    urgency: 'emergency' | 'routine';
    createdAtMillis: number;
    sentAtMillis: number | null;
    linkExpiresAtMillis: number;
    declineReason: string | null;
    allowedActions: HospitalAction[];
  };
  clinic: { name: string; address: string; contactNumber: string };
  midwife: { name: string; contactNumber: string };
  hospital: { name: string };
  summary: {
    state: SummaryState;
    content: QSummaryContent | null;
    /** e.g. "MIDWIFE-REVIEWED" (checkup) or "NOT YET REVIEWED BY MIDWIFE" (emergency) */
    label: string;
    generatedAtMillis: number | null;
  };
  patient: {
    name: string;
    patientId: string;
    birthdate: string;
    ageYears: number | null;
    barangay: string;
    bloodType: BloodType;
    allergies: string[];
    medicalHistory: string[];
    obstetricHistory: string[];
    pregnancy: PregnancyInfo;
    gestationalAge: string;
    trimester: string;
  };
  visits: HospitalVisitView[]; // newest first
  currentMedications: string[];
  riskFlags: { label: string; detail: string; visitDate: string }[];
}

export type GetReferralViewResponse =
  | { ok: true; view: HospitalReferralView }
  | { ok: false; reason: 'expired' | 'revoked' | 'invalid' | 'rate_limited' };

// updateReferralStatus — NO Firebase Auth. Token-validated; server checks canTransition(type, from, to, 'hospital').
export interface UpdateReferralStatusRequest {
  token: string;
  status: HospitalAction;
  declineReason?: string;
  /** Optional free-text name/role of the hospital staff member performing the action. */
  actorName?: string;
}
export interface UpdateReferralStatusResponse {
  status: ReferralStatus;
}

// cancelReferral — auth: clinic staff. Sets CANCELLED and revokes the link.
export interface CancelReferralRequest {
  referralId: string;
  reason: string;
}

// revokeReferralLink — auth: clinic staff. Revokes the current link; status unchanged.
export interface RevokeReferralLinkRequest {
  referralId: string;
}

// resendReferralLink — auth: clinic staff. Rotates the token (old link revoked), returns the new link.
// Never creates a new referral document.
export interface ResendReferralLinkRequest {
  referralId: string;
  smsHospital: boolean;
}
export interface ResendReferralLinkResponse {
  link: ReferralLinkResult;
}

// resendSms — auth: clinic staff of the smsLog's clinic. Re-sends an existing smsLog (retryCount++).
export interface ResendSmsRequest {
  smsLogId: string;
}
export interface ResendSmsResponse {
  status: SmsStatus;
}

// generateReferralPdf — either clinic staff (referralId or patientId) or hospital (token).
export type GenerateReferralPdfRequest = { referralId: string } | { patientId: string } | { token: string };
export interface GenerateReferralPdfResponse {
  fileName: string;
  /** base64-encoded application/pdf. Not stored at a public URL. */
  base64: string;
}

// createStaffUser — auth: clinic_admin = clinic owner (own clinic, role 'midwife' only) or super_admin
// ('midwife' for any clinic, or 'super_admin'). The admin assigns the password; staff sign in with email + password.
// This is the ONLY way staff accounts are created (no self-registration).
export interface CreateStaffUserRequest {
  name: string;
  email: string;
  contactNumber: string;
  role: Role;
  clinicId: string | null;
  /** Assigned by the admin (min 8 chars). Sent once over HTTPS; never stored or logged by MARA. */
  password: string;
}
export interface CreateStaffUserResponse {
  uid: string;
}

// setStaffActive — auth: clinic_admin (own clinic midwives) or super_admin. Never deletes records.
export interface SetStaffActiveRequest {
  uid: string;
  active: boolean;
}

// Responses for management callables (previously untyped).
export interface CancelReferralResponse {
  status: ReferralStatus;
}
export interface RevokeReferralLinkResponse {
  revoked: true;
}
export interface SetStaffActiveResponse {
  uid: string;
  active: boolean;
}

// getReferralReport — auth: clinic_admin (own clinic only; clinicId forced) or super_admin (any/all clinics).
// Returns COUNTS ONLY (no patient names, reasons, or summaries) so super_admin never reads referral documents.
export interface GetReferralReportRequest {
  fromMillis: number;
  toMillis: number;
  clinicId: string | null;
  type: ReferralType | null;
  status: ReferralStatus | null;
}
export interface ReferralReportCounts {
  total: number;
  sent: number; // ever reached SENT
  acknowledged: number; // ever reached ACKNOWLEDGED
  declined: number;
  arrived: number;
  cancelled: number;
  expired: number;
}
export interface ReferralReportRow extends ReferralReportCounts {
  clinicId: string;
  clinicName: string;
  type: ReferralType;
}
export interface GetReferralReportResponse {
  rows: ReferralReportRow[];
  totals: ReferralReportCounts;
}

// processReferralRequest — auth: the clinic staff member who created referralRequests/{requestId}.
// Turns a synced offline emergency request into a referral (idempotent). Needed where Firestore triggers are not
// available (Vercel + Spark plan); harmless alongside the trigger on Blaze.
export interface ProcessReferralRequestRequest {
  requestId: string;
}
export interface ProcessReferralRequestResponse {
  state: ReferralRequestDoc['state'];
  referralId: string | null;
  error: string | null;
}

// ── Clinic registration ──────────────────────────────────────────────────────

// registerClinic — auth: a signed-in Firebase user with NO MARA role and no staff profile yet (just created with
// email/password on the sign-up page). Creates the clinic and makes the caller its owner (clinic_admin).
export type RegisterClinicRequest = ClinicRegistrationInput;
export interface RegisterClinicResponse {
  clinicId: string;
}

/** Error codes surfaced by callables via HttpsError.details.code for user-readable UI messages. */
export type MaraErrorCode =
  | 'CONSENT_REQUIRED'
  | 'HOSPITAL_NOT_ELIGIBLE'
  | 'INVALID_TRANSITION'
  | 'SUMMARY_NOT_READY'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION';

// ─────────────────────────────────────────────────────────────────────────────
// 3. AI SUMMARY (data-minimised)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimum clinical context sent to any SummaryProvider.
 * Contains NO name, patientId, contact numbers, address, emergency contacts, or birthdate.
 */
export interface SummaryContext {
  referralType: ReferralType;
  reasonForReferral: string;
  ageYears: number | null;
  gestationalAge: string;
  trimester: string;
  gravida: number;
  para: number;
  bloodType: string;
  allergies: string[];
  medicalHistory: string[];
  obstetricHistory: string[];
  visits: VisitClinical[]; // oldest → newest
}

/** Backend adapter. Implementations: MockSummaryProvider (dev). Amazon Q is deferred. */
export interface SummaryProvider {
  readonly name: string;
  generate(context: SummaryContext): Promise<QSummaryContent>;
}

/**
 * Summary labels. Summaries are currently rule-based (MockSummaryProvider), so no label claims AI generation.
 * Review status is still shown: the hospital must know whether a midwife checked the summary.
 */
export const AI_LABELS = {
  reviewed: 'MIDWIFE-REVIEWED',
  reviewRequired: 'MIDWIFE REVIEW REQUIRED',
  /** Emergency referrals are sent first; their summary is never reviewed by the midwife before the hospital sees it. */
  notReviewed: 'NOT YET REVIEWED BY MIDWIFE',
  disclaimer: 'Summary of documented records. Not a diagnosis or treatment recommendation.',
} as const;
