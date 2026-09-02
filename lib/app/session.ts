// Clerk session -> app_users row, for the /api/app routes.
import { currentUser } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { ensureUser, AppUser } from './users';
import { q } from '../admin/db';

/** Dev-only: the cs_preview cookie stands in for the CS_PREVIEW_EMAIL user (see middleware.ts). */
async function previewUser(): Promise<AppUser | null> {
  const token = process.env.CS_PREVIEW_TOKEN;
  if (process.env.NODE_ENV === 'production' || !token) return null;
  const c = await cookies();
  if (c.get('cs_preview')?.value !== token) return null;
  const rows = await q<AppUser>(`select * from app_users where email = $1 order by plan = 'owner' desc limit 1`, [process.env.CS_PREVIEW_EMAIL]);
  return rows[0] ?? null;
}

/** The signed-in user's app_users row, creating it on first request. */
export async function requireAppUser(): Promise<AppUser | null> {
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
