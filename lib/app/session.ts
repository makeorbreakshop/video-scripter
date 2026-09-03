// Clerk session -> app_users row, for the /api/app routes.
import { currentUser } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { ensureUser, userByClerkId, AppUser } from './users';
import { one } from '../admin/db';

/**
 * Dev-only: resolve a local session to a specific app_users row by clerk_id.
 *
 * Dev and prod share one database, but Clerk's test and live instances mint different
 * clerk_ids, so signing in on localhost gets its own app_users row with its own follows.
 * Pointing CS_DEV_AS_CLERK_ID at the live clerk_id makes a local session read the
 * production row — the same account, not a copy.
 *
 * Writes are real. Removing a channel on localhost removes it from production. Use
 * scripts/sync-app-user.ts instead when you want prod's follows but local writes.
 */
async function impersonatedUser(): Promise<AppUser | null> {
  const clerkId = process.env.CS_DEV_AS_CLERK_ID;
  if (process.env.NODE_ENV === 'production' || !clerkId) return null;
  const user = await userByClerkId(clerkId);
  if (!user) throw new Error(`CS_DEV_AS_CLERK_ID: no app_users row for ${clerkId}`);
  return user;
}

/**
 * Dev-only: the cs_preview cookie stands in for a fixed user (see middleware.ts).
 *
 * Prefer CS_PREVIEW_CLERK_ID — email is not unique in app_users (the same person signing
 * in through both Clerk instances owns one row per instance), so the CS_PREVIEW_EMAIL
 * fallback needs an explicit tiebreak to keep picking the same row every request.
 */
async function previewUser(): Promise<AppUser | null> {
  const token = process.env.CS_PREVIEW_TOKEN;
  if (process.env.NODE_ENV === 'production' || !token) return null;
  const c = await cookies();
  if (c.get('cs_preview')?.value !== token) return null;
  const clerkId = process.env.CS_PREVIEW_CLERK_ID;
  if (clerkId) return userByClerkId(clerkId);
  return one<AppUser>(
    `select id, clerk_id, email, plan, created_at from app_users
      where email = $1
      order by plan = 'owner' desc, created_at asc, id asc
      limit 1`,
    [process.env.CS_PREVIEW_EMAIL]
  );
}

/** The signed-in user's app_users row, creating it on first request. */
export async function requireAppUser(): Promise<AppUser | null> {
  const as = await impersonatedUser();
  if (as) return as;
  const pv = await previewUser();
  if (pv) return pv;
  const cu = await currentUser();
  if (!cu) return null;
  return ensureUser({
    id: cu.id,
    primaryEmailAddress: cu.primaryEmailAddress ? { emailAddress: cu.primaryEmailAddress.emailAddress } : null,
    emailAddresses: (cu.emailAddresses || []).map((e: any) => ({ emailAddress: e.emailAddress })),
  });
}

export const unauthorized = () =>
  Response.json({ error: 'unauthorized' }, { status: 401 });
