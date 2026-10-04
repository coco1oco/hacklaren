// Shared MARA domain types. Imported by the React app (via the @shared alias) and by Cloud Functions.
// Keep this folder free of Node, browser, and Firebase SDK imports.

export type Role = 'midwife' | 'clinic_admin' | 'super_admin';

export type ReferralType = 'emergency' | 'checkup';

export type ReferralStatus =
  | 'CREATED'
  | 'SENT'
  | 'ACKNOWLEDGED'
  | 'ARRIVED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'CANCELLED';

export type StatusActor = 'midwife' | 'hospital' | 'system';

export type HospitalService = 'CEmONC' | 'BEmONC' | 'NICU' | 'Emergency';

export const HOSPITAL_SERVICES: HospitalService[] = ['CEmONC', 'BEmONC', 'NICU', 'Emergency'];

export type UrineResult = 'not_done' | 'negative' | 'trace' | '1+' | '2+' | '3+' | '4+';

export const URINE_RESULTS: UrineResult[] = ['not_done', 'negative', 'trace', '1+', '2+', '3+', '4+'];

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export interface DangerSigns {
  bleeding: boolean;
  severeHeadache: boolean;
  blurredVision: boolean;
  reducedFetalMovement: boolean;
}

export const DANGER_SIGN_LABELS: Record<keyof DangerSigns, string> = {
  bleeding: 'Bleeding',
  severeHeadache: 'Severe headache',
  blurredVision: 'Blurred vision',
  reducedFetalMovement: 'Reduced fetal movement',
};

/** Clinical content of a prenatal visit (what the midwife enters). */
export interface VisitClinical {
  visitDate: string; // YYYY-MM-DD
  bpSystolic: number;
  bpDiastolic: number;
  weightKg: number;
  fhr?: number | null;
  glucoseMgDl?: number | null;
  fundalHeightCm?: number | null;
  urineProtein: UrineResult;
  urineGlucose: UrineResult;
  medications: string[];
  notes: string;
  dangerSigns: DangerSigns;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  contactNumber: string;
}

export interface PregnancyInfo {
  lmp: string; // YYYY-MM-DD
  edd: string; // YYYY-MM-DD
  gravida: number;
  para: number;
}

export interface Hospital {
  id: string;
  name: string;
  address: string;
  phone: string;
  referralLevel: 1 | 2 | 3;
  services: HospitalService[];
  latitude: number;
  longitude: number;
  dohNetworked: boolean;
  active: boolean;
}

export interface QSummaryContent {
  summary: string;
  keyFindings: string[];
  riskFlags: string[];
  medications: string[];
  reasonForReferral: string;
  abnormalTrends: string[];
}

export type SummaryState = 'not_requested' | 'pending' | 'generating' | 'ready' | 'approved' | 'failed';

export interface ReferralReason {
  code: string;
  label: string;
  text: string;
}

export const EMERGENCY_REASONS: { code: string; label: string }[] = [
  { code: 'severe_bleeding', label: 'Severe bleeding' },
  { code: 'headache_visual', label: 'Severe headache / visual symptoms' },
  { code: 'reduced_fetal_movement', label: 'Reduced fetal movement' },
  { code: 'abnormal_vitals', label: 'Abnormal vital signs' },
  { code: 'labor_complication', label: 'Labor complication' },
  { code: 'other', label: 'Other' },
];

export const AUDIT_ACTIONS = [
  'patient_viewed',
  'patient_created',
  'patient_edited',
  'visit_created',
  'visit_edited',
  'referral_created',
  'referral_viewed',
  'referral_sent',
  'referral_acknowledged',
  'referral_declined',
  'patient_arrived',
  'referral_cancelled',
  'referral_expired',
  'summary_generated',
  'summary_failed',
  'summary_approved',
  'pdf_generated',
  'pdf_downloaded',
  'referral_link_revoked',
  'referral_link_resent',
  'sms_sent',
  'sms_failed',
  'staff_created',
  'staff_deactivated',
  'staff_reactivated',
  'clinic_registered',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Audit actions the browser may write directly (everything else is written server-side only). */
export const CLIENT_AUDIT_ACTIONS: AuditAction[] = ['patient_viewed', 'patient_created', 'patient_edited', 'visit_created', 'visit_edited'];
