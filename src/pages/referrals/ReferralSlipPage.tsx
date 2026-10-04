import { Link, useParams } from 'react-router-dom';
import { useClinicData } from '@/data/ClinicDataProvider';
import { millis } from '@/lib/format';
import { Alert, Button, ButtonLink, Loading } from '@/components/ui';
import { ReferralSlip } from '@/components/referral/ReferralSlip';
import { usePatientVisits } from '@/components/referral/hooks';

export default function ReferralSlipPage() {
  const { referralId } = useParams();
  const { referrals, referralsLoading, patients, clinicId } = useClinicData();
  const referral = referrals.find((r) => r.referralId === referralId || r.id === referralId) ?? null;
  const patient = referral ? (patients.find((p) => p.patientId === referral.patientId) ?? null) : null;
  const visits = usePatientVisits(referral?.patientId, clinicId);

  if (!referral) {
    if (referralsLoading) return <Loading label="Loading referral…" />;
    return (
      <Alert tone="error" title="Referral not found">
        <Link to="/referrals" className="underline">
          Back to referrals
        </Link>
      </Alert>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="no-print flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>Print</Button>
        <ButtonLink to={`/referrals/${referral.referralId}`} variant="secondary">
          Back to referral
        </ButtonLink>
      </div>
      {visits.loading && <p className="no-print text-sm text-slate-700">Loading visits…</p>}
      <ReferralSlip
        data={{
          referralId: referral.referralId,
          createdAtMillis: millis(referral.sentAt) ?? millis(referral.createdAt) ?? Date.now(),
          type: referral.type,
          urgency: referral.urgency,
          clinic: referral.clinic,
          midwife: referral.midwife,
          hospital: referral.hospital,
          patient,
          patientName: referral.patientName,
          reason: [referral.reason.label, referral.reason.text].filter((x, i, a) => x && a.indexOf(x) === i).join(': '),
          visits: visits.data,
        }}
      />
    </div>
  );
}
