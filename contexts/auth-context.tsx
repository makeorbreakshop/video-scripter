"use client"

import type React from "react"
import { authClient, useSession } from "@/lib/auth-client"

export const useAuth = () => {
  const session = useSession()
  
  return {
    user: session.data?.user || null,
    session: session.data || null,
    isLoading: session.isPending,
    signOut: authClient.signOut,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

