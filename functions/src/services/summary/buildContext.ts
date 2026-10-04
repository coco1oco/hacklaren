import type { PatientDoc, SummaryContext } from '../../shared/contracts';
import type { ReferralType, VisitClinical } from '../../shared/types';
import { formatGestationalAge, gestationalAge, trimester, trimesterLabel } from '../../shared/pregnancy';
import { sortVisitsAsc } from '../../shared/riskFlags';
import { ageOnDate, manilaDateIso } from '../time';

export type SummaryPatientInput = Pick<PatientDoc, 'birthdate' | 'pregnancy' | 'bloodType' | 'allergies' | 'medicalHistory' | 'obstetricHistory'>;

/** Copies ONLY the VisitClinical fields (drops ids, clinicId, author names, timestamps). */
export function toVisitClinical(v: VisitClinical): VisitClinical {
  return {
    visitDate: v.visitDate,
    bpSystolic: v.bpSystolic,
    bpDiastolic: v.bpDiastolic,
    weightKg: v.weightKg,
    fhr: v.fhr ?? null,
    glucoseMgDl: v.glucoseMgDl ?? null,
    fundalHeightCm: v.fundalHeightCm ?? null,
    urineProtein: v.urineProtein,
    urineGlucose: v.urineGlucose,
    medications: [...(v.medications ?? [])],
    notes: v.notes ?? '',
    dangerSigns: {
      bleeding: !!v.dangerSigns?.bleeding,
      severeHeadache: !!v.dangerSigns?.severeHeadache,
      blurredVision: !!v.dangerSigns?.blurredVision,
      reducedFetalMovement: !!v.dangerSigns?.reducedFetalMovement,
    },
  };
}

/**
 * Data-minimised context for the AI provider. Never includes name, patientId, contact numbers,
 * address, barangay, emergency contact or birthdate (age only).
 */
export function buildSummaryContext(
  patient: SummaryPatientInput,
  visits: VisitClinical[],
  referral: { type: ReferralType; reasonText: string },
  now: Date = new Date(),
): SummaryContext {
  const today = manilaDateIso(now.getTime());
  const ga = gestationalAge(patient.pregnancy.lmp, today);
  return {
    referralType: referral.type,
    reasonForReferral: referral.reasonText,
    ageYears: ageOnDate(patient.birthdate, today),
    gestationalAge: formatGestationalAge(ga),
    trimester: trimesterLabel(trimester(ga)),
    gravida: patient.pregnancy.gravida,
    para: patient.pregnancy.para,
    bloodType: patient.bloodType,
    allergies: [...(patient.allergies ?? [])],
    medicalHistory: [...(patient.medicalHistory ?? [])],
    obstetricHistory: [...(patient.obstetricHistory ?? [])],
    visits: sortVisitsAsc(visits.map(toVisitClinical)),
  };
}
