// Clerk session -> app_users row, for the /api/app routes.
import { currentUser } from '@clerk/nextjs/server';
import { ensureUser, AppUser } from './users';

/** The signed-in user's app_users row, creating it on first request. */
export async function requireAppUser(): Promise<AppUser | null> {
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
