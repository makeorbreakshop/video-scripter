"use client"

import { useAuth } from "@/contexts/auth-context"
import { LoginButton } from "./login-button"

interface ProtectedRouteProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function ProtectedRoute({ children, fallback }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!user) {
    return fallback || (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Sign in required</h2>
          <p className="text-muted-foreground mb-6">
            Please sign in to access this feature
          </p>
          <LoginButton />
        </div>
      </div>
    )
  }

  return <>{children}</>
}