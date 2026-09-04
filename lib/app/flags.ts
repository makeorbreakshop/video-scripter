// Feature flags that gate a page to specific accounts. Pure: the layout and the page both
// call these with the app user they already have; no extra reads.

/** Emails allowed to see Inspiration. INSPIRATION_USERS is a comma-separated list; the owner is always in. */
export function inspirationAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = (env.INSPIRATION_USERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  raw.push('brandon@makeorbreakshop.com');
  return new Set(raw);
}

/**
 * Inspiration depends on a vector service that only runs on Brandon's machine, so the page
 * (and its nav entry) exists for his accounts only until that service has a home.
 */
export function canSeeInspiration(
  user: { email?: string | null; plan?: string | null } | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!user) return false;
  if ((user.plan ?? '').toLowerCase() === 'owner') return true;
  const email = (user.email ?? '').trim().toLowerCase();
  return !!email && inspirationAllowlist(env).has(email);
}
