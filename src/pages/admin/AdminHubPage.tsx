import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/ui';
import { ClinicServerCodeCard } from '@/components/ClinicServerCode';

export default function AdminHubPage() {
  const { claims } = useAuth();
  const isSuper = claims?.role === 'super_admin';
  const items = [
    { to: '/admin/midwives', title: 'Staff accounts', desc: isSuper ? 'Create staff for any clinic, activate or deactivate accounts.' : 'Create midwife accounts for your clinic and activate or deactivate them.' },
    { to: '/admin/clinics', title: isSuper ? 'Clinics' : 'Clinic details', desc: isSuper ? 'Add and edit clinics, including BHW / MHO alert numbers.' : 'Update your clinic contact details and BHW / MHO alert numbers.' },
    ...(isSuper ? [{ to: '/admin/hospitals', title: 'Hospitals', desc: 'Add and edit receiving hospitals. Hospitals are deactivated, never deleted.' }] : []),
    { to: '/admin/reports', title: 'Reports', desc: 'Referrals sent, acknowledged, declined, and patients arrived.' },
  ];
  return (
    <div>
      <PageHeader title="Admin" subtitle={isSuper ? 'System administration' : 'Clinic administration'} />
      {!isSuper && (
        <div className="mb-4">
          <ClinicServerCodeCard />
        </div>
      )}
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((i) => (
          <li key={i.to}>
            <Link to={i.to} className="block min-h-12 rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-800">
              <span className="block text-lg font-bold text-brand-800 underline">{i.title}</span>
              <span className="block text-slate-700">{i.desc}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
