import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Only apply restrictions in production (Vercel)
  const isProduction = process.env.NODE_ENV === 'production'
  
  // Skip middleware entirely in development
  if (!isProduction) {
    return NextResponse.next()
  }
  
  const path = request.nextUrl.pathname
  
  // Allow these paths in production
  const allowedPaths = [
    '/thumbnail-battle',
    '/api/thumbnail-battle',  // API routes for the game
    '/_next',  // Next.js assets
    '/favicon.ico',
    '/'  // Homepage (which redirects to thumbnail-battle)
  ]
  
  // Check if path is allowed
  const isAllowed = allowedPaths.some(allowed => 
    path === allowed || path.startsWith(allowed + '/')
  )
  
  if (!isAllowed) {
    // Redirect all other paths to thumbnail battle (production only)
    return NextResponse.redirect(new URL('/thumbnail-battle', request.url))
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}