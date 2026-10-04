import type { ReactNode } from 'react';
import type { PatientDoc } from '@shared/contracts';
import type { ReferralType, VisitClinical } from '@shared/types';
import { ageInYears, formatGestationalAge, gestationalAge, trimester, trimesterLabel } from '@shared/pregnancy';
import { currentMedications, sortVisitsAsc } from '@shared/riskFlags';
import { formatDate, formatDateTime, URINE_LABELS } from '@/lib/format';

export interface SlipData {
  /** null while the emergency request is still queued offline. */
  referralId: string | null;
  clientRequestId?: string;
  createdAtMillis: number;
  type: ReferralType;
  urgency: 'emergency' | 'routine';
  clinic: { name: string; address: string; contactNumber: string };
  midwife: { name: string; contactNumber: string };
  hospital: { name: string; address: string; phone: string };
  patient: Pick<PatientDoc, 'name' | 'patientId' | 'birthdate' | 'pregnancy' | 'bloodType' | 'allergies'> | null;
  /** Fallback when the patient record is not available on this device. */
  patientName: string;
  reason: string;
  visits: VisitClinical[];
}

export const SLIP_DISCLAIMER =
  'This printable slip supports the existing referral process. It is not an officially certified electronic replacement for the DOH referral form.';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 border-b border-slate-300 py-1 print:py-0.5">
      <dt className="font-semibold">{label}</dt>
      <dd>{children || '—'}</dd>
    </div>
  );
}

export function ReferralSlip({ data }: { data: SlipData }) {
  const p = data.patient;
  const ga = p ? gestationalAge(p.pregnancy.lmp) : null;
  const latest = sortVisitsAsc(data.visits).at(-1) ?? null;
  const meds = currentMedications(data.visits);
  const age = p ? ageInYears(p.birthdate) : null;

  return (
    <article className="rounded-lg border-2 border-slate-900 bg-white p-4 text-slate-950 print:border-0 print:p-0">
      <header className="border-b-2 border-slate-900 pb-2">
        <h1 className="text-2xl font-bold">Referral Slip (printable aid)</h1>
        <p className="mt-1 text-sm">{SLIP_DISCLAIMER}</p>
      </header>

      <section className="mt-3" aria-label="Referral">
        <dl>
          <Row label="Referral ID">
            {data.referralId ?? (
              <>
                Pending: not yet transmitted <span className="text-sm">(request {data.clientRequestId})</span>
              </>
            )}
          </Row>
          <Row label="Date / time">{formatDateTime(data.createdAtMillis)}</Row>
          <Row label="Type / urgency">
            {data.type === 'emergency' ? 'Emergency' : 'Checkup'} / {data.urgency === 'emergency' ? 'Emergency' : 'Routine'}
          </Row>
          <Row label="From clinic">
            {data.clinic.name}
            {data.clinic.address && `, ${data.clinic.address}`}
          </Row>
          <Row label="Referring midwife">
            {data.midwife.name} {data.midwife.contactNumber && `· ${data.midwife.contactNumber}`}
          </Row>
          <Row label="Clinic contact">{data.clinic.contactNumber}</Row>
          <Row label="To hospital">
            {data.hospital.name}
            {data.hospital.address && `, ${data.hospital.address}`} {data.hospital.phone && `· ${data.hospital.phone}`}
          </Row>
        </dl>
      </section>

      <section className="mt-3" aria-label="Patient">
        <h2 className="text-lg font-bold">Patient</h2>
        <dl>
          <Row label="Name">{p?.name ?? data.patientName}</Row>
          <Row label="Patient ID">{p?.patientId}</Row>
          <Row label="Age">{age !== null ? `${age} years` : ''}</Row>
          {p && (
            <>
              <Row label="Gestational age">
                {formatGestationalAge(ga)} ({trimesterLabel(trimester(ga))})
              </Row>
              <Row label="EDD">{formatDate(p.pregnancy.edd)}</Row>
              <Row label="G / P">
                G{p.pregnancy.gravida} P{p.pregnancy.para}
              </Row>
              <Row label="Blood type">{p.bloodType}</Row>
              <Row label="Allergies">{p.allergies.length ? p.allergies.join(', ') : 'None recorded'}</Row>
            </>
          )}
        </dl>
      </section>

      <section className="mt-3" aria-label="Clinical">
        <h2 className="text-lg font-bold">Reason and latest observations</h2>
        <dl>
          <Row label="Reason for referral">{data.reason}</Row>
          <Row label="Latest vitals">
            {latest
              ? [
                  `${formatDate(latest.visitDate)}: BP ${latest.bpSystolic}/${latest.bpDiastolic} mmHg`,
                  `Weight ${latest.weightKg} kg`,
                  latest.fhr != null ? `FHR ${latest.fhr} bpm` : null,
                  latest.glucoseMgDl != null ? `Glucose ${latest.glucoseMgDl} mg/dL` : null,
                  latest.fundalHeightCm != null ? `Fundal height ${latest.fundalHeightCm} cm` : null,
                  `Urine protein ${URINE_LABELS[latest.urineProtein] ?? latest.urineProtein}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No visits recorded'}
          </Row>
          <Row label="Current medications">{meds.length ? meds.join(', ') : 'None recorded'}</Row>
        </dl>
      </section>

      <section className="mt-8 grid gap-8 sm:grid-cols-2 print:grid-cols-2" aria-label="Signatures">
        <div>
          <div className="h-10 border-b border-slate-900" />
          <p className="text-sm">Referring midwife: signature over printed name</p>
        </div>
        <div>
          <div className="h-10 border-b border-slate-900" />
          <p className="text-sm">Receiving hospital staff: signature, date and time</p>
        </div>
      </section>
    </article>
  );
}
