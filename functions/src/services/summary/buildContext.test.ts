import { describe, expect, it } from 'vitest';
import { buildSummaryContext } from './buildContext';
import type { PatientDoc, TimestampLike, VisitDoc } from '../../shared/contracts';
import type { VisitClinical } from '../../shared/types';

const ts = (n: number): TimestampLike => ({ toMillis: () => n });

const VISIT_CLINICAL_KEYS: (keyof VisitClinical)[] = [
  'visitDate',
  'bpSystolic',
  'bpDiastolic',
  'weightKg',
  'fhr',
  'glucoseMgDl',
  'fundalHeightCm',
  'urineProtein',
  'urineGlucose',
  'medications',
  'notes',
  'dangerSigns',
];

const IDENT = {
  name: 'Zelda Quintana',
  patientId: 'MARA-PAT-ZQ77',
  contactNumber: '09171112233',
  address: '123 Sampaguita Street',
  barangay: 'Barangay Maligaya',
  emergencyName: 'Ramon Quintana',
  emergencyRelationship: 'Brother-in-law',
  emergencyNumber: '09184445566',
  birthdate: '1994-07-21',
  createdBy: 'uid-midwife-777',
  createdByName: 'Midwife Josefina Reyes',
  clinicId: 'clinic-zz-42',
};

const patient: PatientDoc = {
  patientId: IDENT.patientId,
  name: IDENT.name,
  nameLower: IDENT.name.toLowerCase(),
  birthdate: IDENT.birthdate,
  address: IDENT.address,
  barangay: IDENT.barangay,
  contactNumber: IDENT.contactNumber,
  emergencyContact: { name: IDENT.emergencyName, relationship: IDENT.emergencyRelationship, contactNumber: IDENT.emergencyNumber },
  pregnancy: { lmp: '2026-03-10', edd: '2026-12-15', gravida: 2, para: 1 },
  allergies: ['Penicillin'],
  bloodType: 'O+',
  medicalHistory: ['Asthma'],
  obstetricHistory: ['G1: SVD 2023'],
  consent: { dataSharingForReferral: true, capturedAt: ts(1), capturedBy: IDENT.createdBy },
  clinicId: IDENT.clinicId,
  active: true,
  version: 3,
  createdAt: ts(1),
  createdBy: IDENT.createdBy,
  updatedAt: ts(2),
  updatedBy: IDENT.createdBy,
};

const visitDoc = (visitId: string, visitDate: string, bpSystolic: number): VisitDoc => ({
  visitId,
  patientId: IDENT.patientId,
  clinicId: IDENT.clinicId,
  createdAt: ts(10),
  createdBy: IDENT.createdBy,
  createdByName: IDENT.createdByName,
  version: 1,
  updatedAt: ts(10),
  updatedBy: IDENT.createdBy,
  visitDate,
  bpSystolic,
  bpDiastolic: 80,
  weightKg: 60,
  fhr: 140,
  glucoseMgDl: null,
  fundalHeightCm: 28,
  urineProtein: 'negative',
  urineGlucose: 'negative',
  medications: ['Ferrous sulfate'],
  notes: 'Patient well.',
  dangerSigns: { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false },
});

const visits = [visitDoc('v-c', '2026-10-01', 150), visitDoc('v-a', '2026-08-01', 120), visitDoc('v-b', '2026-09-01', 135)];

describe('buildSummaryContext', () => {
  const ctx = buildSummaryContext(patient, visits, { type: 'checkup', reasonText: 'Rising BP across visits' });

  it('contains no direct identifiers', () => {
    const json = JSON.stringify(ctx);
    for (const [field, value] of Object.entries(IDENT)) expect(json, `leaked ${field}`).not.toContain(value);
    expect(json).not.toContain('Quintana');
    expect(json).not.toContain('Sampaguita');
  });

  it('has no identifier keys at the top level', () => {
    for (const key of ['name', 'patientId', 'contactNumber', 'address', 'barangay', 'emergencyContact', 'birthdate', 'clinicId']) {
      expect(ctx).not.toHaveProperty(key);
    }
  });

  it('sorts visits oldest → newest', () => {
    expect(ctx.visits.map((v) => v.visitDate)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(ctx.visits.map((v) => v.bpSystolic)).toEqual([120, 135, 150]);
  });

  it('strips visits to VisitClinical keys only', () => {
    for (const v of ctx.visits) {
      for (const key of Object.keys(v)) expect(VISIT_CLINICAL_KEYS, `unexpected visit key ${key}`).toContain(key);
      expect(v).not.toHaveProperty('visitId');
      expect(v).not.toHaveProperty('createdBy');
      expect(v).not.toHaveProperty('createdByName');
      expect(v).not.toHaveProperty('clinicId');
      expect(v).not.toHaveProperty('patientId');
    }
  });

  it('does not mutate the input visit order', () => {
    expect(visits.map((v) => v.visitId)).toEqual(['v-c', 'v-a', 'v-b']);
  });

  it('carries the minimised clinical context', () => {
    expect(ctx.referralType).toBe('checkup');
    expect(ctx.reasonForReferral).toContain('Rising BP across visits');
    expect(ctx.gravida).toBe(2);
    expect(ctx.para).toBe(1);
    expect(ctx.bloodType).toBe('O+');
    expect(ctx.allergies).toEqual(['Penicillin']);
    expect(ctx.medicalHistory).toEqual(['Asthma']);
    expect(ctx.obstetricHistory).toEqual(['G1: SVD 2023']);
    expect(typeof ctx.ageYears === 'number' || ctx.ageYears === null).toBe(true);
    expect(typeof ctx.gestationalAge).toBe('string');
    expect(typeof ctx.trimester).toBe('string');
  });

  it('supports emergency referrals', () => {
    const e = buildSummaryContext(patient, [], { type: 'emergency', reasonText: 'Severe bleeding' });
    expect(e.referralType).toBe('emergency');
    expect(e.reasonForReferral).toContain('Severe bleeding');
    expect(e.visits).toEqual([]);
  });
});
