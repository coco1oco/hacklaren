import { AI_LABELS, type ClinicDoc, type HospitalReferralView, type HospitalVisitView, type PatientDoc, type ReferralDoc, type VisitDoc } from '../shared/contracts';
import type { QSummaryContent } from '../shared/types';
import { allowedHospitalActions } from '../shared/referralStatus';
import { formatGestationalAge, gestationalAge, trimester, trimesterLabel } from '../shared/pregnancy';
import { currentMedications, sortVisitsAsc, visitRiskFlags } from '../shared/riskFlags';
import { toVisitClinical } from './summary/buildContext';
import { ageOnDate, manilaDateIso } from './time';

const millis = (t: { toMillis(): number } | null | undefined): number | null => (t ? t.toMillis() : null);

export function summaryLabel(type: ReferralDoc['type']): string {
  return type === 'checkup' ? `${AI_LABELS.generated} · ${AI_LABELS.reviewed}` : `${AI_LABELS.generated} · ${AI_LABELS.emergencyAfterSend}`;
}

/** Visit list for the hospital: clinical fields + author name + GA at the visit date, newest first. */
export function toHospitalVisits(lmp: string, visits: VisitDoc[]): HospitalVisitView[] {
  return sortVisitsAsc(visits)
    .reverse()
    .map((v) => ({
      ...toVisitClinical(v),
      visitId: v.visitId,
      recordedBy: v.createdByName ?? '',
      gestationalAge: formatGestationalAge(gestationalAge(lmp, v.visitDate)),
    }));
}

/** Patient section without contact numbers, address, or emergency contact. */
export function hospitalPatient(patient: PatientDoc, now: Date): HospitalReferralView['patient'] {
  const today = manilaDateIso(now.getTime());
  const ga = gestationalAge(patient.pregnancy.lmp, today);
  return {
    name: patient.name,
    patientId: patient.patientId,
    birthdate: patient.birthdate,
    ageYears: ageOnDate(patient.birthdate, today),
    barangay: patient.barangay,
    bloodType: patient.bloodType,
    allergies: [...(patient.allergies ?? [])],
    medicalHistory: [...(patient.medicalHistory ?? [])],
    obstetricHistory: [...(patient.obstetricHistory ?? [])],
    pregnancy: { ...patient.pregnancy },
    gestationalAge: formatGestationalAge(ga),
    trimester: trimesterLabel(trimester(ga)),
  };
}

export function hospitalRiskFlags(visits: HospitalVisitView[]): HospitalReferralView['riskFlags'] {
  return visits.flatMap((v) => visitRiskFlags(v).map((f) => ({ label: f.label, detail: f.detail, visitDate: f.visitDate })));
}

/** Pure projection of a referral into the token-gated hospital view. */
export function buildHospitalView(referral: ReferralDoc, patient: PatientDoc, visits: VisitDoc[], linkExpiresAtMillis: number, now: Date = new Date()): HospitalReferralView {
  const hv = toHospitalVisits(patient.pregnancy.lmp, visits);
  const s = referral.summary;
  const content: QSummaryContent | null = referral.type === 'checkup' ? (s.approvedContent ?? null) : s.state === 'ready' || s.state === 'approved' ? (s.content ?? null) : null;
  return {
    referral: {
      referralId: referral.referralId,
      type: referral.type,
      status: referral.status,
      statusHistory: (referral.statusHistory ?? []).map((h) => ({ status: h.status, atMillis: h.at.toMillis(), actor: h.actor })),
      reason: { ...referral.reason },
      urgency: referral.urgency,
      createdAtMillis: referral.createdAt.toMillis(),
      sentAtMillis: millis(referral.sentAt),
      linkExpiresAtMillis,
      declineReason: referral.declineReason ?? null,
      allowedActions: allowedHospitalActions(referral.type, referral.status),
    },
    clinic: { name: referral.clinic.name, address: referral.clinic.address, contactNumber: referral.clinic.contactNumber },
    midwife: { name: referral.midwife.name, contactNumber: referral.midwife.contactNumber },
    hospital: { name: referral.hospital.name },
    summary: {
      state: s.state,
      content,
      label: summaryLabel(referral.type),
      generatedAtMillis: millis(s.generatedAt),
    },
    patient: hospitalPatient(patient, now),
    visits: hv,
    currentMedications: currentMedications(hv),
    riskFlags: hospitalRiskFlags(hv),
  };
}

/** Data for a patient-only PDF export (from the patient profile; no referral). */
export interface PatientExportData {
  clinic: { name: string; address: string; contactNumber: string };
  patient: HospitalReferralView['patient'];
  visits: HospitalVisitView[];
  currentMedications: string[];
  riskFlags: HospitalReferralView['riskFlags'];
}

export function buildPatientExportData(patient: PatientDoc, visits: VisitDoc[], clinic: Pick<ClinicDoc, 'name' | 'address' | 'contactNumber'> | null, now: Date = new Date()): PatientExportData {
  const hv = toHospitalVisits(patient.pregnancy.lmp, visits);
  return {
    clinic: { name: clinic?.name ?? '', address: clinic?.address ?? '', contactNumber: clinic?.contactNumber ?? '' },
    patient: hospitalPatient(patient, now),
    visits: hv,
    currentMedications: currentMedications(hv),
    riskFlags: hospitalRiskFlags(hv),
  };
}
