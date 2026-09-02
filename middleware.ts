// Clerk auth gate. Protected: the admin, the legacy dashboard, and their API routes.
// Public: everything else (Thumbnail Battle, marketing pages, extension + websub ingestion routes).
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtected = createRouteMatcher([
  '/admin(.*)',
  '/dashboard(.*)',
  '/quota-dashboard(.*)',
  '/api/admin(.*)',
  '/api/pipeline(.*)',
  '/api/view-tracking(.*)',
  '/api/worker(.*)',
  '/api/workers(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
    // Always run for Clerk-specific frontend API routes
    '/__clerk/(.*)',
  ],
};
