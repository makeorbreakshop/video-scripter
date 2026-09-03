// /app/settings — profile (Clerk), plan + usage, API keys, billing/delete placeholders.
import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { listKeys } from '@/lib/app/api-keys';
import { planUsage } from '@/lib/app/users';
import { requireAppUser } from '@/lib/app/session';
import { listConnections } from '@/lib/app/youtube-connect';
import { jobsForUser } from '@/lib/app/backfill-jobs';
import { backfillStatus } from '@/lib/app/backfill-status';
import SettingsClient from '../_components/settings-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ youtube?: string }> }) {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  // Clerk's currentUser() throws when its middleware did not run, which is the case under the
  // dev preview cookie (middleware.ts skips Clerk entirely). Only the display name and avatar
  // come from it, so degrade rather than 500 the page.
  const cu = await currentUser().catch(() => null);

  const [usage, keys, youtube, jobs, sp] = await Promise.all([
    planUsage(user.id), listKeys(user.id), listConnections(user.id).catch(() => []),
    jobsForUser(user.id).catch(() => []), searchParams,
  ]);
  // Import progress is computed on the server so the wording lives in one tested place.
  const youtubeWithStatus = youtube.map((c) => ({
    ...c,
    sync: backfillStatus(jobs.find((j) => j.channel_id === c.channel_id) ?? null, c.last_synced_at),
  }));

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
      youtube={youtubeWithStatus}
      youtubeStatus={sp?.youtube ?? null}
    />
  );
}
