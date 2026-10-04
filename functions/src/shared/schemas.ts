import { z } from 'zod';
import { BLOOD_TYPES, EMERGENCY_REASONS, HOSPITAL_SERVICES, URINE_RESULTS } from './types';
import { INPUT_HARD_LIMITS } from './riskFlags';
import { parseIsoDate } from './pregnancy';

// Zod schemas shared by React Hook Form (client) and Cloud Functions (server-side validation).

export const isoDate = z.string().refine((v) => parseIsoDate(v) !== null, { message: 'Enter a valid date (YYYY-MM-DD).' });

/** Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX. */
export const phMobile = z
  .string()
  .trim()
  .regex(/^(\+639|09)\d{9}$/, { message: 'Enter a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX).' });

/** Any dialable phone number (hospital landlines included). */
export const phoneNumber = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, { message: 'Enter a valid phone number.' });

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, label: string) => z.string().trim().min(1, { message: `${label} is required.` }).max(max);
const stringList = z.array(z.string().trim().min(1).max(200)).max(50);

function ranged(field: keyof typeof INPUT_HARD_LIMITS, label: string) {
  const [min, max] = INPUT_HARD_LIMITS[field];
  return z
    .number({ message: `${label} must be a number.` })
    .finite()
    .min(min, { message: `${label} must be at least ${min}.` })
    .max(max, { message: `${label} must be at most ${max}.` });
}

export const dangerSignsSchema = z.object({
  bleeding: z.boolean(),
  severeHeadache: z.boolean(),
  blurredVision: z.boolean(),
  reducedFetalMovement: z.boolean(),
});

export const visitClinicalSchema = z
  .object({
    visitDate: isoDate,
    bpSystolic: ranged('bpSystolic', 'Systolic BP'),
    bpDiastolic: ranged('bpDiastolic', 'Diastolic BP'),
    weightKg: ranged('weightKg', 'Weight'),
    fhr: ranged('fhr', 'FHR').nullable().optional(),
    glucoseMgDl: ranged('glucoseMgDl', 'Glucose').nullable().optional(),
    fundalHeightCm: ranged('fundalHeightCm', 'Fundal height').nullable().optional(),
    urineProtein: z.enum(URINE_RESULTS as [string, ...string[]]),
    urineGlucose: z.enum(URINE_RESULTS as [string, ...string[]]),
    medications: stringList,
    notes: trimmed(4000),
    dangerSigns: dangerSignsSchema,
  })
  .refine((v) => v.bpSystolic > v.bpDiastolic, { message: 'Systolic BP must be higher than diastolic BP.', path: ['bpDiastolic'] });

export type VisitClinicalInput = z.infer<typeof visitClinicalSchema>;

export const emergencyContactSchema = z.object({
  name: requiredText(120, 'Emergency contact name'),
  relationship: requiredText(60, 'Relationship'),
  contactNumber: phMobile,
});

export const pregnancySchema = z
  .object({
    lmp: isoDate,
    edd: isoDate,
    gravida: z.number().int().min(1).max(20),
    para: z.number().int().min(0).max(20),
  })
  .refine((p) => p.para < p.gravida, { message: 'Para must be less than gravida for a current pregnancy.', path: ['para'] });

export const patientInputSchema = z.object({
  name: requiredText(120, 'Name'),
  birthdate: isoDate,
  address: requiredText(300, 'Address'),
  barangay: requiredText(120, 'Barangay'),
  contactNumber: phMobile,
  emergencyContact: emergencyContactSchema,
  pregnancy: pregnancySchema,
  allergies: stringList,
  bloodType: z.enum(BLOOD_TYPES),
  medicalHistory: stringList,
  obstetricHistory: stringList,
  consentGiven: z.boolean(),
});

export type PatientInput = z.infer<typeof patientInputSchema>;

export const hospitalInputSchema = z.object({
  name: requiredText(160, 'Name'),
  address: requiredText(300, 'Address'),
  phone: phoneNumber,
  referralLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  services: z.array(z.enum(HOSPITAL_SERVICES as [string, ...string[]])).max(10),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  dohNetworked: z.boolean(),
  active: z.boolean(),
});

export type HospitalInput = z.infer<typeof hospitalInputSchema>;

const emergencyReasonCodes = EMERGENCY_REASONS.map((r) => r.code) as [string, ...string[]];

export const emergencyReferralInputSchema = z
  .object({
    patientId: requiredText(64, 'Patient'),
    hospitalId: requiredText(64, 'Hospital'),
    reasonCode: z.enum(emergencyReasonCodes),
    reasonText: trimmed(1000),
    /** Idempotency key generated on the client so retries/offline replays never duplicate a referral. */
    clientRequestId: z.string().uuid(),
  })
  .refine((v) => v.reasonCode !== 'other' || v.reasonText.length > 0, { message: 'Describe the reason when "Other" is selected.', path: ['reasonText'] });

export type EmergencyReferralInput = z.infer<typeof emergencyReferralInputSchema>;

export const checkupReferralInputSchema = z.object({
  patientId: requiredText(64, 'Patient'),
  hospitalId: requiredText(64, 'Hospital'),
  reasonText: requiredText(1000, 'Reason for referral'),
  clientRequestId: z.string().uuid(),
});

export type CheckupReferralInput = z.infer<typeof checkupReferralInputSchema>;

export const qSummaryContentSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  keyFindings: z.array(z.string().trim().min(1).max(500)).max(30),
  riskFlags: z.array(z.string().trim().min(1).max(500)).max(30),
  medications: z.array(z.string().trim().min(1).max(200)).max(50),
  reasonForReferral: z.string().trim().min(1).max(1000),
  abnormalTrends: z.array(z.string().trim().min(1).max(500)).max(30),
});

export const declineReasonSchema = z.string().trim().min(3, { message: 'A decline reason is required.' }).max(1000);

// ── Accounts ─────────────────────────────────────────────────────────────────
// Staff never self-register. The clinic owner (or a super admin) creates each staff account with an email and an
// assigned password; staff sign in with exactly that email + password.

/** Password assigned by the clinic owner / super admin when creating a staff account. */
export const staffPasswordSchema = z
  .string()
  .min(8, { message: 'Use at least 8 characters for the password.' })
  .max(128, { message: 'Password is too long.' });

export const clinicRegistrationSchema = z.object({
  clinic: z.object({
    name: requiredText(160, 'Clinic name'),
    address: requiredText(300, 'Clinic address'),
    barangay: requiredText(120, 'Barangay'),
    city: requiredText(120, 'City / municipality'),
    province: requiredText(120, 'Province'),
    contactNumber: phoneNumber,
  }),
  adminName: requiredText(120, 'Your name'),
  adminContactNumber: phMobile,
});

export type ClinicRegistrationInput = z.infer<typeof clinicRegistrationSchema>;

/** Raw link tokens are 32 random bytes encoded as base64url (43 chars). */
export const rawTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
