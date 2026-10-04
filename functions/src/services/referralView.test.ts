import { describe, expect, it } from 'vitest';
import { buildHospitalView } from './referralView';
import { AI_LABELS } from '../shared/contracts';
import type { PatientDoc, ReferralDoc, ReferralSummary, TimestampLike, VisitDoc } from '../shared/contracts';
import { allowedHospitalActions } from '../shared/referralStatus';
import type { QSummaryContent, ReferralStatus, ReferralType } from '../shared/types';

const ts = (n: number): TimestampLike => ({ toMillis: () => n });

const SECRET = {
  contactNumber: '09171112233',
  address: '123 Sampaguita Street',
  emergencyName: 'Ramon Quintana',
  emergencyNumber: '09184445566',
};

const patient: PatientDoc = {
  patientId: 'MARA-PAT-ZQ77',
  name: 'Zelda Quintana',
  nameLower: 'zelda quintana',
  birthdate: '1994-07-21',
  address: SECRET.address,
  barangay: 'Barangay Maligaya',
  contactNumber: SECRET.contactNumber,
  emergencyContact: { name: SECRET.emergencyName, relationship: 'Spouse', contactNumber: SECRET.emergencyNumber },
  pregnancy: { lmp: '2026-03-10', edd: '2026-12-15', gravida: 2, para: 1 },
  allergies: ['Penicillin'],
  bloodType: 'O+',
  medicalHistory: ['Asthma'],
  obstetricHistory: ['G1: SVD 2023'],
  consent: { dataSharingForReferral: true, capturedAt: ts(1), capturedBy: 'uid-mw' },
  clinicId: 'clinic-1',
  active: true,
  version: 1,
  createdAt: ts(1),
  createdBy: 'uid-mw',
  updatedAt: ts(1),
  updatedBy: 'uid-mw',
};

const visitDoc = (visitId: string, visitDate: string, bpSystolic: number, medications: string[]): VisitDoc => ({
  visitId,
  patientId: patient.patientId,
  clinicId: 'clinic-1',
  createdAt: ts(10),
  createdBy: 'uid-mw',
  createdByName: 'Josefina Reyes',
  version: 1,
  updatedAt: ts(10),
  updatedBy: 'uid-mw',
  visitDate,
  bpSystolic,
  bpDiastolic: 80,
  weightKg: 60,
  fhr: 140,
  glucoseMgDl: null,
  fundalHeightCm: 28,
  urineProtein: 'negative',
  urineGlucose: 'negative',
  medications,
  notes: '',
  dangerSigns: { bleeding: false, severeHeadache: false, blurredVision: false, reducedFetalMovement: false },
});

const visits = [
  visitDoc('v-b', '2026-09-01', 130, ['Ferrous sulfate']),
  visitDoc('v-c', '2026-10-01', 152, ['Ferrous sulfate', 'Calcium carbonate']),
  visitDoc('v-a', '2026-08-01', 120, ['Folic acid']),
];

const content = (summary: string): QSummaryContent => ({
  summary,
  keyFindings: ['BP 152/80 mmHg at 2026-10-01'],
  riskFlags: ['Elevated BP'],
  medications: ['Ferrous sulfate'],
  reasonForReferral: 'Rising BP',
  abnormalTrends: [],
});

const summary = (overrides: Partial<ReferralSummary>): ReferralSummary => ({
  state: 'ready',
  provider: 'mock',
  content: null,
  approvedContent: null,
  edited: false,
  generatedAt: ts(500),
  approvedAt: null,
  approvedBy: null,
  error: null,
  attempts: 1,
  ...overrides,
});

const referral = (type: ReferralType, status: ReferralStatus, s: ReferralSummary): ReferralDoc => ({
  referralId: 'MARA-REF-AB12',
  type,
  status,
  statusHistory: [
    { status: 'CREATED', at: ts(100), actor: 'midwife', uid: 'uid-mw', note: null },
    { status: 'SENT', at: ts(200), actor: 'midwife', uid: 'uid-mw', note: null },
  ],
  patientId: patient.patientId,
  patientName: patient.name,
  clinicId: 'clinic-1',
  hospitalId: 'h1',
  hospital: { name: 'Provincial Hospital', phone: '(044) 123-4567', address: 'Capitol Rd' },
  clinic: { name: 'RHU Maligaya', contactNumber: '(044) 765-4321', address: 'Poblacion Hall' },
  midwife: { uid: 'uid-mw', name: 'Josefina Reyes', contactNumber: '09990001111' },
  reason: { code: 'checkup', label: 'Checkup referral', text: 'Rising BP' },
  urgency: type === 'emergency' ? 'emergency' : 'routine',
  summary: s,
  link: { expiresAt: ts(9_000), revoked: false, issuedAt: ts(200), issueCount: 1 },
  declineReason: null,
  cancelReason: null,
  consentAtReferral: true,
  clientRequestId: '6f1c1f0e-2a7b-4c2e-9d3a-0b6f1c1f0e2a',
  createdAt: ts(100),
  createdBy: 'uid-mw',
  updatedAt: ts(200),
  sentAt: ts(200),
  acknowledgedAt: null,
  declinedAt: null,
  arrivedAt: null,
  cancelledAt: null,
  expiredAt: null,
});

const NOW = new Date(2026, 9, 4);

describe('buildHospitalView', () => {
  const checkup = referral('checkup', 'SENT', summary({ state: 'approved', content: content('RAW-AI-TEXT'), approvedContent: content('EDITED-BY-MIDWIFE'), edited: true, approvedAt: ts(600), approvedBy: 'uid-mw' }));
  const view = buildHospitalView(checkup, patient, visits, 9_000, NOW);

  it('lists visits newest first', () => {
    expect(view.visits.map((v) => v.visitDate)).toEqual(['2026-10-01', '2026-09-01', '2026-08-01']);
    expect(view.visits[0].visitId).toBe('v-c');
  });

  it('checkup: shows the midwife-approved summary with the reviewed label', () => {
    expect(view.summary.content?.summary).toBe('EDITED-BY-MIDWIFE');
    expect(view.summary.label).toContain(AI_LABELS.reviewed);
    expect(view.summary.label).toContain(AI_LABELS.generated);
    expect(JSON.stringify(view)).not.toContain('RAW-AI-TEXT');
  });

  it('emergency: shows the raw AI summary labelled as generated after transmission', () => {
    const r = referral('emergency', 'SENT', summary({ state: 'ready', content: content('EMERGENCY-AI') }));
    const v = buildHospitalView(r, patient, visits, 9_000, NOW);
    expect(v.summary.content?.summary).toBe('EMERGENCY-AI');
    expect(v.summary.label).toContain(AI_LABELS.emergencyAfterSend);
    expect(v.summary.generatedAtMillis).toBe(500);
  });

  it('failed summary → content null', () => {
    for (const type of ['emergency', 'checkup'] as const) {
      const r = referral(type, 'SENT', summary({ state: 'failed', content: null, error: 'provider error', generatedAt: null }));
      const v = buildHospitalView(r, patient, visits, 9_000, NOW);
      expect(v.summary.state).toBe('failed');
      expect(v.summary.content).toBeNull();
    }
  });

  it('pending emergency summary → content null', () => {
    const r = referral('emergency', 'SENT', summary({ state: 'pending', content: null, generatedAt: null }));
    expect(buildHospitalView(r, patient, visits, 9_000, NOW).summary.content).toBeNull();
  });

  it('allowedActions matches allowedHospitalActions', () => {
    const cases: [ReferralType, ReferralStatus][] = [
      ['checkup', 'SENT'],
      ['checkup', 'ACKNOWLEDGED'],
      ['emergency', 'SENT'],
      ['emergency', 'ACKNOWLEDGED'],
      ['emergency', 'ARRIVED'],
      ['checkup', 'CANCELLED'],
    ];
    for (const [type, status] of cases) {
      const v = buildHospitalView(referral(type, status, summary({ state: 'approved', content: content('x'), approvedContent: content('x') })), patient, visits, 9_000, NOW);
      expect(v.referral.allowedActions, `${type}/${status}`).toEqual(allowedHospitalActions(type, status));
    }
  });

  it('never exposes patient contact number, address or emergency contact', () => {
    const json = JSON.stringify(view);
    for (const [field, value] of Object.entries(SECRET)) expect(json, `leaked ${field}`).not.toContain(value);
    expect(view.patient).not.toHaveProperty('contactNumber');
    expect(view.patient).not.toHaveProperty('address');
    expect(view.patient).not.toHaveProperty('emergencyContact');
  });

  it('includes referral metadata, midwife contact and derived clinical data', () => {
    expect(view.referral.referralId).toBe('MARA-REF-AB12');
    expect(view.referral.linkExpiresAtMillis).toBe(9_000);
    expect(view.referral.createdAtMillis).toBe(100);
    expect(view.referral.sentAtMillis).toBe(200);
    expect(view.referral.statusHistory.map((h) => h.atMillis)).toEqual([100, 200]);
    expect(view.midwife.contactNumber).toBe('09990001111');
    expect(view.hospital.name).toBe('Provincial Hospital');
    expect(view.patient.name).toBe('Zelda Quintana');
    expect(view.patient.ageYears).toBe(32);
    expect(view.patient.gestationalAge).toBe('29 weeks 5 days');
    expect(view.patient.trimester).toBe('3rd trimester');
    expect(view.currentMedications).toEqual(['Ferrous sulfate', 'Calcium carbonate']);
    expect(view.riskFlags.some((f) => f.visitDate === '2026-10-01')).toBe(true);
  });

  it('does not leak internal visit/referral fields', () => {
    const json = JSON.stringify(view);
    expect(json).not.toContain('uid-mw');
    expect(json).not.toContain('6f1c1f0e-2a7b-4c2e-9d3a-0b6f1c1f0e2a');
  });
});
