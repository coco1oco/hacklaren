import type { ReactNode } from 'react';
import { Card, PageHeader } from '@/components/ui';

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="ml-5 list-decimal space-y-1">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ol>
  );
}

export default function HelpPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Quick Start" subtitle="Gabay sa paggamit ng MARA" />

      <Card title="Register a patient (Magrehistro ng pasyente)">
        <Steps
          items={[
            <>
              Open <strong>Patients</strong> and tap <strong>Add Patient</strong>.
            </>,
            'Enter her details, emergency contact, and LMP. MARA suggests the EDD from the LMP and shows the gestational age and trimester.',
            'If the dates look unusual, MARA shows a warning. Check the dates, then tick the confirmation box.',
            'Ask for consent to share her record with the receiving hospital and tick the consent box if she agrees.',
            'If MARA finds a possible existing patient, tap View Existing to check, or Continue Anyway if she is a different person.',
          ]}
        />
      </Card>

      <Card title="Record a visit (Itala ang check-up)">
        <Steps
          items={[
            <>
              Open the patient profile and tap <strong>New Visit</strong>.
            </>,
            'Enter BP, weight, and other measurements. Medications are copied from the last visit; remove any she no longer takes.',
            'A yellow warning means the value is outside the usual input range. Check the measurement. You can still save.',
            'Tick any danger signs she reports, then tap Save visit.',
          ]}
        />
      </Card>

      <Card title="Emergency referral (Emergency na referral)">
        <Steps
          items={[
            <>
              On the patient profile tap the red <strong>EMERGENCY REFERRAL</strong> button.
            </>,
            'Choose the hospital and the reason. The referral is sent immediately and you get a hospital link right away.',
            'Call the hospital. The Q summary is prepared in the background and never delays the referral.',
            'If you are offline, the referral is queued on the phone and sent automatically when the connection returns. Call the hospital in the meantime.',
          ]}
        />
      </Card>

      <Card title="Checkup referral (Referral para sa check-up)">
        <Steps
          items={[
            <>
              On the patient profile tap <strong>Checkup Referral</strong>, choose the hospital and write the reason.
            </>,
            'MARA prepares an Q summary of the documented records. Read it carefully and edit anything that is not accurate.',
            'Send the referral after your review. The hospital sees that the summary was reviewed by a midwife.',
            'If the summary is unavailable, review the raw chart manually and tap Retry summary.',
            'Checkup referrals need the patient’s consent to share her record.',
          ]}
        />
      </Card>

      <Card title="How hospital links work">
        <ul className="ml-5 list-disc space-y-1">
          <li>The hospital opens the link in a browser. No account or app is needed.</li>
          <li>Each link expires automatically, usually between 24 and 72 hours after it is issued.</li>
          <li>You can revoke a link at any time from the referral page. It stops working immediately.</li>
          <li>
            <strong>Resend link</strong> issues a new link and the old link stops working. It is the same referral, not a new one.
          </li>
          <li>The link is shown only once. Share it right away by SMS or copy it.</li>
          <li>The hospital can acknowledge the referral, record the patient’s arrival, and (for checkups) decline with a reason. You see updates in real time.</li>
        </ul>
      </Card>

      <Card title="Offline mode (Walang internet)">
        <ul className="ml-5 list-disc space-y-1">
          <li>You can register patients, record visits, and queue emergency referrals without internet.</li>
          <li>
            Items not yet on the server show <strong>Pending sync</strong>. The dashboard shows “⚠ N items pending synchronization” until everything is “✓ Synced”.
          </li>
          <li>If the server does not accept a change, it appears under “Sync conflict requires review”. Nothing is deleted until you choose to re-apply or discard it.</li>
          <li>Do not log out while items are pending. Logging out clears patient data from the device.</li>
          <li>Checkup referrals, PDF export, and admin changes need a connection.</li>
        </ul>
      </Card>

      <Card title="Privacy and safety">
        <ul className="ml-5 list-disc space-y-1">
          <li>You are signed out automatically after a period of inactivity. Always log out on shared phones.</li>
          <li>SMS messages never contain clinical details.</li>
          <li>Risk flags highlight recorded values for review. MARA does not diagnose. Observation requires clinical review.</li>
        </ul>
      </Card>
      {/* The layout footer shows "Designed to complement existing referral workflows." on every page. */}
    </div>
  );
}
