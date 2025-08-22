"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // In production, redirect to thumbnail battle game
    // In development, redirect to dashboard
    const isProduction = process.env.NODE_ENV === 'production'
    router.push(isProduction ? "/thumbnail-battle" : "/dashboard")
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
    </div>
  )
}

