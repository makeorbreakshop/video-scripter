// App user records, keyed to Clerk. Direct Postgres only (lib/admin/db.ts) —
// never supabase-js (2026-08-31 org-wide egress incident).
import { q, one } from '../admin/db';
import { normalizePlan, planLimits, PlanLimits, PlanName } from './plans';

export interface AppUser {
  id: string;
  clerk_id: string;
  email: string | null;
  plan: string;
  created_at: string;
}

export interface ClerkUserLike {
  id: string;
  emailAddresses?: Array<{ emailAddress?: string | null }> | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
}

export function clerkEmail(u: ClerkUserLike): string | null {
  return (
    u.primaryEmailAddress?.emailAddress ||
    u.emailAddresses?.[0]?.emailAddress ||
    null
  );
}

/**
 * Get-or-create the app_users row for a Clerk user. Idempotent; refreshes the
 * email when Clerk has one (and never blanks a stored email with a null).
 */
export async function ensureUser(clerkUser: ClerkUserLike): Promise<AppUser> {
  if (!clerkUser?.id) throw new Error('ensureUser: missing clerk id');
  const rows = await q<AppUser>(
    `insert into app_users (clerk_id, email) values ($1, $2)
     on conflict (clerk_id) do update
       set email = coalesce(excluded.email, app_users.email)
     returning id, clerk_id, email, plan, created_at`,
    [clerkUser.id, clerkEmail(clerkUser)]
  );
  return rows[0];
}

export async function userByClerkId(clerkId: string): Promise<AppUser | null> {
  return one<AppUser>(
    `select id, clerk_id, email, plan, created_at from app_users where clerk_id = $1`,
    [clerkId]
  );
}

/** The user's plan, normalized. Unknown users read as 'free'. */
export async function userPlan(userId: string): Promise<PlanName> {
  const row = await one<{ plan: string }>(`select plan from app_users where id = $1`, [userId]);
  return normalizePlan(row?.plan);
}

export interface PlanUsage {
  plan: PlanName;
  limits: PlanLimits;
  tracked: number;
  watchedClosely: number;
}

/** Plan + current usage in one round trip — what the limit checks need. */
export async function planUsage(userId: string): Promise<PlanUsage> {
  const row = await one<{ plan: string; tracked: string; watched: string }>(
    `select u.plan,
            count(uc.channel_id) as tracked,
            count(*) filter (where uc.watched_closely) as watched
       from app_users u
       left join user_channels uc on uc.user_id = u.id
      where u.id = $1
      group by u.plan`,
    [userId]
  );
  const plan = normalizePlan(row?.plan);
  return {
    plan,
    limits: planLimits(plan),
    tracked: parseInt(row?.tracked || '0', 10),
    watchedClosely: parseInt(row?.watched || '0', 10),
  };
}
