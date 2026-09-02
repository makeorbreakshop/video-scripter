// /app/settings — profile (Clerk), plan + usage, API keys, billing/delete placeholders.
import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { listKeys } from '@/lib/app/api-keys';
import { planUsage } from '@/lib/app/users';
import { requireAppUser } from '@/lib/app/session';
import SettingsClient from '../_components/settings-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  const cu = await currentUser();

  const [usage, keys] = await Promise.all([planUsage(user.id), listKeys(user.id)]);

  return (
    <SettingsClient
      profile={{
        name: cu ? [cu.firstName, cu.lastName].filter(Boolean).join(' ') || cu.username || null : null,
        email: user.email,
        imageUrl: cu?.imageUrl ?? null,
      }}
      plan={usage.plan}
      limits={usage.limits}
      usage={{ tracked: usage.tracked, watched_closely: usage.watchedClosely }}
      keys={keys as any}
    />
  );
}
