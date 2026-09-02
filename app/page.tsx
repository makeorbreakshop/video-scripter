"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to thumbnail battle
    router.push("/thumbnail-battle")
  }, [router])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 bg-background px-6">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>

      <div className="w-full max-w-sm border border-white/10 rounded-lg p-6 text-left">
        <p className="text-lg font-semibold mb-1">Now track the channels you're beating</p>
        <p className="text-sm text-muted-foreground mb-4">
          See every thumbnail swap and title change your competitors make, and whether it worked.
        </p>
        <Link
          href="/app"
          className="inline-block bg-[#00ff00] text-black rounded-lg py-2 px-6 text-sm font-semibold hover:bg-[#00ff00]/90 transition-colors"
        >
          Start tracking
        </Link>
        <p className="text-xs text-muted-foreground mt-3">Free for 2 channels.</p>
      </div>
    </div>
  )
}

