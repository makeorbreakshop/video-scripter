import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  
  // Allow these paths
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
    // Redirect all other paths to thumbnail battle
    return NextResponse.redirect(new URL('/thumbnail-battle', request.url))
  }
  
  return NextResponse.next()
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}