import { ButtonLink } from '@/components/ui';

export default function NotFoundPage() {
  return (
    <div className="py-8">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-slate-700">The page you are looking for does not exist or has moved. (Hindi nakita ang pahina.)</p>
      <ButtonLink to="/dashboard" className="mt-4">
        Go to dashboard
      </ButtonLink>
    </div>
  );
}
