import { useNow } from '@/lib/useOnline';
import { formatRemaining } from '@/lib/format';

export function LinkExpiry({ expiresAtMillis, revoked = false }: { expiresAtMillis: number | null; revoked?: boolean }) {
  const now = useNow(30_000);
  if (revoked) return <p className="font-semibold text-red-800">This referral link has been revoked.</p>;
  if (expiresAtMillis === null) return null;
  const left = expiresAtMillis - now;
  if (left <= 0) return <p className="font-semibold text-red-800">This referral link has expired.</p>;
  return (
    <p className="font-semibold text-slate-900">
      This referral link expires in: <span className="tabular-nums">{formatRemaining(left)}</span>
    </p>
  );
}
