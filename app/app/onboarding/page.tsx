// /app/onboarding — where a user with no channels lands (see /app/feed's redirect).
import { redirect } from 'next/navigation';
import { q } from '@/lib/admin/db';
import { requireAppUser } from '@/lib/app/session';
import OnboardingClient from '../_components/onboarding-client';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');

  const tracked = await q<{ channel_id: string; role: string }>(
    'select channel_id, role from user_channels where user_id = $1 order by added_at asc',
    [user.id]
  );

  return <OnboardingClient initialTracked={tracked} />;
}
