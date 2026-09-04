/**
 * Which routes need a session. Data rather than a literal inside middleware.ts, so the policy
 * can be asserted without loading Clerk's server bundle — see lib/app/public-routes.test.ts.
 */

/** The product and its back office. */
export const PRODUCT_ROUTES = [
  '/admin(.*)',
  '/app(.*)',
  '/dashboard(.*)',
  '/quota-dashboard(.*)',
];

/**
 * Scratch routes: half-built pages, competing designs kept side by side, and /test-* probes.
 * Useful to keep and reachable while signed in, but they are not the product — a stranger who
 * lands on /title-generator/version2-dashboard or /thumbnail-battle-redesigned has seen a
 * different, worse ChannelSmith.
 */
export const SCRATCH_ROUTES = [
  '/test(.*)',
  '/discovery/test(.*)',
  '/ml(.*)',
  '/thread-expansion-tester(.*)',
  '/thumbnail-battle-v2(.*)',
  '/thumbnail-battle-redesigned(.*)',
  '/title-generator/version1-minimal(.*)',
  '/title-generator/version2-dashboard(.*)',
  '/title-generator/version3-cards(.*)',
  '/youtube-demo(.*)',
  '/youtube-demo-v2(.*)',
];

/** The API surfaces that authenticate by session rather than by key. */
export const PROTECTED_API = [
  '/api/admin(.*)',
  '/api/app(.*)',
  '/api/pipeline(.*)',
  '/api/view-tracking(.*)',
  '/api/worker(.*)',
  '/api/workers(.*)',
];

export const PROTECTED_ROUTES = [...PRODUCT_ROUTES, ...SCRATCH_ROUTES, ...PROTECTED_API];
