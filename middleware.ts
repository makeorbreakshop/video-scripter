// Clerk auth gate. Protected: the admin, the legacy dashboard, and their API routes.
// Public: everything else (Thumbnail Battle, marketing pages, extension + websub ingestion routes).
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';

// The public API authenticates itself with bearer API keys (lib/api/v1.ts), so Clerk must not
// touch it: a session cookie is not how an agent or a curl call talks to /api/v1, and letting
// Clerk redirect these to a sign-in page would turn a 401 into an HTML 302.
const isPublicApi = createRouteMatcher(['/api/v1(.*)']);

const isProtected = createRouteMatcher([
  '/admin(.*)',
  '/app(.*)',
  '/dashboard(.*)',
  '/quota-dashboard(.*)',
  '/api/admin(.*)',
  '/api/app(.*)',
  '/api/pipeline(.*)',
  '/api/view-tracking(.*)',
  '/api/worker(.*)',
  '/api/workers(.*)',
]);

// Dev-only preview: with the cs_preview cookie equal to CS_PREVIEW_TOKEN, protected pages open
// without Clerk so they can be screenshotted on localhost. Clerk's middleware starts a
// dev-browser handshake before our handler runs, so the bypass must skip Clerk entirely.
function previewBypass(req: NextRequest): boolean {
  const token = process.env.CS_PREVIEW_TOKEN;
  return process.env.NODE_ENV !== 'production' && !!token && req.cookies.get('cs_preview')?.value === token;
}

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isPublicApi(req)) return;
  if (isProtected(req)) await auth.protect();
});

export default function middleware(req: NextRequest, evt: NextFetchEvent) {
  if (previewBypass(req)) return NextResponse.next();
  return withClerk(req, evt);
}

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
