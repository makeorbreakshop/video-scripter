"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Check, X, RefreshCw } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

export function GoogleApiSettings() {
  const [apiKey, setApiKey] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [showSecrets, setShowSecrets] = useState(false)
  const [testStatus, setTestStatus] = useState<null | "success" | "error">(null)
  const [testMessage, setTestMessage] = useState("")
  const [isTesting, setIsTesting] = useState(false)
  const { toast } = useToast()

  // Load saved credentials on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedApiKey = localStorage.getItem("YOUTUBE_API_KEY") || ""
      const savedClientId = localStorage.getItem("GOOGLE_CLIENT_ID") || ""
      const savedClientSecret = localStorage.getItem("GOOGLE_CLIENT_SECRET") || ""
      
      setApiKey(savedApiKey)
      setClientId(savedClientId)
      setClientSecret(savedClientSecret)
    }
  }, [])
  
  // Save credentials to localStorage
  const saveCredentials = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem("YOUTUBE_API_KEY", apiKey.trim())
      localStorage.setItem("GOOGLE_CLIENT_ID", clientId.trim())
      localStorage.setItem("GOOGLE_CLIENT_SECRET", clientSecret.trim())
    }
    
    toast({
      title: "Settings saved",
      description: "Your Google API credentials have been saved.",
      duration: 3000,
    })
    
    // Force reload to apply changes
    window.location.reload()
  }
  
  // Clear all credentials
  const clearCredentials = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem("YOUTUBE_API_KEY")
      localStorage.removeItem("GOOGLE_CLIENT_ID")
      localStorage.removeItem("GOOGLE_CLIENT_SECRET")
      localStorage.removeItem("youtube_oauth_tokens")
    }
    
    setApiKey("")
    setClientId("")
    setClientSecret("")
    
    toast({
      title: "Credentials cleared",
      description: "All Google API credentials have been removed.",
      duration: 3000,
    })
    
    // Force reload to apply changes
    window.location.reload()
  }
  
  // Test the API connection
  const testConnection = async () => {
    setIsTesting(true)
    setTestStatus(null)
    
    try {
      // Test API key if provided
      if (apiKey) {
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=dQw4w9WgXcQ&key=${apiKey}`
        )
        
        if (!response.ok) {
          throw new Error("API Key test failed")
        }
        
        const data = await response.json()
        if (!data.items || data.items.length === 0) {
          throw new Error("No video data returned")
        }
      }
      
      // OAuth config check (we can't fully test OAuth without redirecting)
      if (clientId && clientSecret) {
        if (!clientId.endsWith("apps.googleusercontent.com")) {
          throw new Error("Client ID appears invalid (should end with apps.googleusercontent.com)")
        }
      }
      
      setTestStatus("success")
      setTestMessage(apiKey ? "Connection successful! API key works correctly." : 
                              "OAuth credentials saved. Sign in to test.")
    } catch (error) {
      console.error("API test error:", error)
      setTestStatus("error")
      setTestMessage(error instanceof Error ? error.message : "Connection test failed")
    } finally {
      setIsTesting(false)
    }
  }
  
  // Sign out of Google (clear tokens only)
  const signOut = () => {
    localStorage.removeItem("youtube_oauth_tokens")
    toast({
      title: "Signed out",
      description: "You've been signed out of your Google account.",
      duration: 3000,
    })
    window.location.reload()
  }
  
  // Trigger sign in
  const signIn = () => {
    if (!clientId) {
      toast({
        title: "Client ID Required",
        description: "Please enter your OAuth Client ID first",
        variant: "destructive",
      })
      return
    }
    
    // Build the authorization URL
    const redirectUri = `${window.location.origin}/oauth-callback`
    const scope = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl"
    const state = Math.random().toString(36).substring(2, 15)
    localStorage.setItem("oauth_state", state)
    
    // Construct URL with force prompt to allow switching accounts
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    authUrl.searchParams.append("client_id", clientId)
    authUrl.searchParams.append("redirect_uri", redirectUri)
    authUrl.searchParams.append("response_type", "code")
    authUrl.searchParams.append("scope", scope)
    authUrl.searchParams.append("state", state)
    authUrl.searchParams.append("access_type", "offline")
    authUrl.searchParams.append("prompt", "select_account consent") // Force account selection
    
    // Redirect to Google
    window.location.href = authUrl.toString()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Google API Settings</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Configure credentials for YouTube data access
        </p>
      </div>
      
      <div className="space-y-4 p-4 border rounded-md">
        <div className="space-y-2">
          <label htmlFor="apiKey" className="text-sm font-medium flex justify-between">
            <span>YouTube API Key (optional)</span>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-5 text-xs"
              onClick={() => setShowSecrets(!showSecrets)}
            >
              {showSecrets ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
              {showSecrets ? "Hide" : "Show"}
            </Button>
          </label>
          <Input
            id="apiKey"
            type={showSecrets ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIza..."
          />
          <p className="text-xs text-muted-foreground">
            Used for video metadata and comments
          </p>
        </div>
        
        <div className="space-y-2">
          <label htmlFor="clientId" className="text-sm font-medium">
            OAuth Client ID (required for transcripts)
          </label>
          <Input
            id="clientId"
            type={showSecrets ? "text" : "password"}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456789-xxxx.apps.googleusercontent.com"
          />
        </div>
        
        <div className="space-y-2">
          <label htmlFor="clientSecret" className="text-sm font-medium">
            OAuth Client Secret
          </label>
          <Input
            id="clientSecret"
            type={showSecrets ? "text" : "password"}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="GOCSPX-..."
          />
        </div>
        
        <div className="pt-2 flex items-center justify-between">
          <div className="space-x-2">
            <Button onClick={saveCredentials} variant="default">
              Save Credentials
            </Button>
            <Button onClick={clearCredentials} variant="outline">
              Clear All
            </Button>
          </div>
          
          <Button
            onClick={testConnection}
            variant="outline"
            disabled={isTesting || (!apiKey && !clientId)}
            className="flex items-center"
          >
            {isTesting ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <span>Test Connection</span>
            )}
          </Button>
        </div>
        
        {testStatus && (
          <div className={`mt-2 p-2 rounded text-sm ${
            testStatus === "success" ? "bg-green-50 text-green-700 border border-green-200" :
            "bg-red-50 text-red-700 border border-red-200"
          }`}>
            <div className="flex items-center">
              {testStatus === "success" ? (
                <Check className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <X className="h-4 w-4 mr-2 text-red-500" />
              )}
              <span>{testMessage}</span>
            </div>
          </div>
        )}
      </div>
      
      <div className="space-y-2 p-4 border rounded-md">
        <h3 className="text-sm font-medium">Google Account</h3>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">
              {localStorage.getItem("youtube_oauth_tokens") 
                ? "Currently signed in to YouTube" 
                : "Not signed in to YouTube"}
            </p>
          </div>
          
          {localStorage.getItem("youtube_oauth_tokens") ? (
            <Button onClick={signOut} variant="outline" size="sm">
              Sign Out
            </Button>
          ) : (
            <Button 
              onClick={signIn} 
              variant="outline" 
              size="sm"
              disabled={!clientId}
            >
              Sign In / Switch Account
            </Button>
          )}
        </div>
      </div>
      
      <div className="text-xs text-muted-foreground">
        <p>All credentials are stored securely in your browser's local storage.</p>
        <p>No data is sent to any server except Google's API endpoints.</p>
      </div>
    </div>
  )
} 