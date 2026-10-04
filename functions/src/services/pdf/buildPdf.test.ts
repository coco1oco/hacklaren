import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildReferralPdf } from './buildPdf';
import { AI_LABELS } from '../../shared/contracts';
import type { HospitalReferralView, HospitalVisitView } from '../../shared/contracts';

// Note: pdf-lib cannot extract text, so the watermark / "AI-GENERATED" label text is not asserted here.

const visit = (i: number): HospitalVisitView => {
  const day = new Date(Date.UTC(2026, 0, 1) + i * 7 * 86_400_000).toISOString().slice(0, 10);
  return {
    visitId: `v-${i}`,
    recordedBy: 'Josefina Reyes',
    gestationalAge: `${8 + i} weeks`,
    visitDate: day,
    bpSystolic: 110 + (i % 40),
    bpDiastolic: 70 + (i % 25),
    weightKg: 55 + i * 0.3,
    fhr: i % 3 === 0 ? null : 140,
    glucoseMgDl: 90,
    fundalHeightCm: 20 + (i % 15),
    urineProtein: 'negative',
    urineGlucose: 'negative',
    medications: ['Ferrous sulfate', 'Folic acid'],
    notes: 'Routine prenatal visit. Patient reports no complaints. Advised to return in one week for follow-up. '.repeat(2),
    dangerSigns: { bleeding: false, severeHeadache: i % 10 === 0, blurredVision: false, reducedFetalMovement: false },
  };
};

const view = (visitCount: number): HospitalReferralView => ({
  referral: {
    referralId: 'MARA-REF-AB12',
    type: 'checkup',
    status: 'SENT',
    statusHistory: [
      { status: 'CREATED', atMillis: 100, actor: 'midwife' },
      { status: 'SENT', atMillis: 200, actor: 'midwife' },
    ],
    reason: { code: 'checkup', label: 'Checkup referral', text: 'Rising BP across visits' },
    urgency: 'routine',
    createdAtMillis: Date.UTC(2026, 9, 1),
    sentAtMillis: Date.UTC(2026, 9, 1),
    linkExpiresAtMillis: Date.UTC(2026, 9, 3),
    declineReason: null,
    allowedActions: ['ACKNOWLEDGED', 'DECLINED'],
  },
  clinic: { name: 'RHU Maligaya', address: 'Poblacion Hall', contactNumber: '(044) 765-4321' },
  midwife: { name: 'Josefina Reyes', contactNumber: '09990001111' },
  hospital: { name: 'Provincial Hospital' },
  summary: {
    state: 'approved',
    content: {
      summary: 'Documented BP readings increased across the last three visits. Observation requires clinical review.',
      keyFindings: ['BP 152/96 mmHg recorded on 2026-10-01'],
      riskFlags: ['Elevated BP'],
      medications: ['Ferrous sulfate'],
      reasonForReferral: 'Rising BP across visits',
      abnormalTrends: ['Systolic BP increased across the last 3 visits (130 → 142 → 152 mmHg).'],
    },
    label: `${AI_LABELS.generated} · ${AI_LABELS.reviewed}`,
    generatedAtMillis: Date.UTC(2026, 9, 1),
  },
  patient: {
    name: 'Zelda Quintana',
    patientId: 'MARA-PAT-ZQ77',
    birthdate: '1994-07-21',
    ageYears: 32,
    barangay: 'Barangay Maligaya',
    bloodType: 'O+',
    allergies: ['Penicillin'],
    medicalHistory: ['Asthma'],
    obstetricHistory: ['G1: SVD 2023'],
    pregnancy: { lmp: '2026-03-10', edd: '2026-12-15', gravida: 2, para: 1 },
    gestationalAge: '29 weeks 5 days',
    trimester: '3rd trimester',
  },
  visits: Array.from({ length: visitCount }, (_, i) => visit(visitCount - 1 - i)), // newest first
  currentMedications: ['Ferrous sulfate', 'Folic acid'],
  riskFlags: [{ label: 'Elevated BP', detail: 'BP 152/96 mmHg. Observation requires clinical review.', visitDate: '2026-10-01' }],
});

const toBytes = (b: Uint8Array | ArrayBuffer): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b));
const header = (b: Uint8Array) => String.fromCharCode(...b.slice(0, 4));

describe('buildReferralPdf', () => {
  it('produces a loadable PDF', async () => {
    const bytes = toBytes(await buildReferralPdf({ view: view(3), generatedAtMillis: Date.UTC(2026, 9, 4) }));
    expect(header(bytes)).toBe('%PDF');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('paginates long charts', async () => {
    const bytes = toBytes(await buildReferralPdf({ view: view(40), generatedAtMillis: Date.UTC(2026, 9, 4) }));
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('handles a failed/missing summary and no visits', async () => {
    const v = view(0);
    v.summary = { state: 'failed', content: null, label: AI_LABELS.generated, generatedAtMillis: null };
    const bytes = toBytes(await buildReferralPdf({ view: v, generatedAtMillis: Date.UTC(2026, 9, 4) }));
    expect(header(bytes)).toBe('%PDF');
  });

  it('handles non-WinAnsi characters (→, ñ, ·) without throwing', async () => {
    const v = view(1);
    v.patient.name = 'Señora Niña Peñafrancia';
    const bytes = toBytes(await buildReferralPdf({ view: v, generatedAtMillis: Date.UTC(2026, 9, 4) }));
    expect(header(bytes)).toBe('%PDF');
  });
});
