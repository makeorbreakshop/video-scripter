"use client"

import { useState, useEffect } from "react"
import { Auth } from "@supabase/auth-ui-react"
import { ThemeSupa } from "@supabase/auth-ui-shared"
import { supabase } from "@/lib/supabase"

export function AuthComponent() {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  if (!isClient) return null

  return (
    <div className="max-w-md mx-auto p-6 bg-card rounded-lg shadow-lg">
      <h1 className="text-2xl font-bold mb-6 text-center">YouTube Script Editor</h1>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        theme="dark"
        providers={["google", "github"]}
        redirectTo={`${window.location.origin}/dashboard`}
      />
    </div>
  )
}

