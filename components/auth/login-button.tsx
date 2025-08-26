"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { signIn } from "@/lib/auth-client"
import { toast } from "sonner"

export function LoginButton() {
  const [isLoading, setIsLoading] = useState(false)

  const handleGoogleLogin = async () => {
    setIsLoading(true)
    try {
      await signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
      })
    } catch (error) {
      console.error("Login error:", error)
      toast.error("Failed to sign in")
    } finally {
      setIsLoading(false)
    }
  }

  const handleGitHubLogin = async () => {
    setIsLoading(true)
    try {
      await signIn.social({
        provider: "github", 
        callbackURL: "/dashboard",
      })
    } catch (error) {
      console.error("Login error:", error)
      toast.error("Failed to sign in")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex gap-2">
      <Button 
        onClick={handleGoogleLogin} 
        disabled={isLoading}
        variant="outline"
      >
        {isLoading ? "Loading..." : "Sign in with Google"}
      </Button>
      <Button 
        onClick={handleGitHubLogin} 
        disabled={isLoading}
        variant="outline"
      >
        {isLoading ? "Loading..." : "Sign in with GitHub"}
      </Button>
    </div>
  )
}