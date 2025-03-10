"use client"

import type React from "react"

// Simply pass through children without any authentication checks
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

