"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { AlertCircle, CheckCircle2, X, Eye, EyeOff, ExternalLink } from "lucide-react"
import { toast } from "@/components/ui/use-toast"

export function ApiKeySetup() {
  const [apiKey, setApiKey] = useState("")
  const [currentApiKey, setCurrentApiKey] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState("")
  const [openAIKey, setOpenAIKey] = useState("")

  // Load the current API key from localStorage on component mount
  useEffect(() => {
    const storedKey = localStorage.getItem('YOUTUBE_API_KEY') || '';
    
    if (storedKey) {
      setCurrentApiKey(storedKey);
      // Mask the key for display
      setApiKey(storedKey);
    } else {
      // Check if there's an env variable set
      const envKey = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
      if (envKey) {
        setCurrentApiKey(envKey);
        setApiKey(envKey);
      }
    }
  }, []);

  // Fetch saved key on component mount
  useEffect(() => {
    const savedOpenAIKey = localStorage.getItem('OPENAI_API_KEY') || '';
    setOpenAIKey(savedOpenAIKey);
  }, []);

  const saveApiKey = () => {
    if (!apiKey.trim()) {
      setStatus('error');
      setErrorMessage("Please enter a valid API key");
      return;
    }

    setStatus('saving');

    try {
      // Store in localStorage for client-side persistence
      localStorage.setItem('YOUTUBE_API_KEY', apiKey);
      
      // In a real application, you might want to store this server-side
      // via an API call for better security
      
      setCurrentApiKey(apiKey);
      setStatus('success');
      
      // We need to reload the page to make the new key available to all components
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Failed to save API key:", error);
      setStatus('error');
      setErrorMessage("Failed to save the API key. Please try again.");
    }
  };

  const clearApiKey = () => {
    localStorage.removeItem('YOUTUBE_API_KEY');
    setApiKey('');
    setCurrentApiKey(null);
    setStatus('idle');
    
    // We need to reload the page to update all components
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const toggleShowApiKey = () => {
    setShowApiKey(prev => !prev);
  };

  // Add code to handle OpenAI API key
  const handleOpenAIKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value.trim();
    setOpenAIKey(key);
  };

  const saveOpenAIKey = () => {
    if (openAIKey) {
      localStorage.setItem('OPENAI_API_KEY', openAIKey);
      toast({
        title: "OpenAI API Key Saved",
        description: "Your OpenAI API key has been saved to your browser.",
      });
    } else {
      localStorage.removeItem('OPENAI_API_KEY');
      toast({
        title: "OpenAI API Key Removed",
        description: "Your OpenAI API key has been removed.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">YouTube API Key</h2>
        <p className="text-sm text-muted-foreground">
          To use YouTube data features, you need to provide a YouTube API Key.
        </p>
        {currentApiKey ? (
          <Alert variant="default" className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertTitle className="text-green-800 dark:text-green-300">API Key Configured</AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-400 text-sm">
              Your YouTube API key is currently set and ready to use.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>API Key Missing</AlertTitle>
            <AlertDescription className="text-sm">
              You need to configure a YouTube API key to fetch real video data.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <label htmlFor="apikey" className="text-sm font-medium">
            YouTube API Key
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id="apikey"
                type={showApiKey ? "text" : "password"} 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your YouTube API key here"
                className="pr-10"
              />
              <button 
                type="button"
                onClick={toggleShowApiKey}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showApiKey ? "Hide API key" : "Show API key"}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {currentApiKey && (
              <Button 
                variant="outline" 
                size="icon" 
                onClick={clearApiKey}
                title="Clear API key"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button 
              onClick={saveApiKey} 
              disabled={status === 'saving'}
              className="min-w-[100px]"
            >
              {status === 'saving' ? 'Saving...' : 'Save Key'}
            </Button>
          </div>
          
          {status === 'error' && (
            <p className="text-sm text-red-500 mt-1">{errorMessage}</p>
          )}
          
          {status === 'success' && (
            <p className="text-sm text-green-600 mt-1">API key saved successfully! Reloading...</p>
          )}
        </div>
        
        <div className="mt-6 border-t pt-4">
          <h3 className="text-sm font-medium mb-2">How to get a YouTube API key</h3>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>1. Go to the <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline inline-flex items-center">
              Google Cloud Console
              <ExternalLink className="h-3 w-3 ml-1" />
            </a></li>
            <li>2. Create a new project or select an existing one</li>
            <li>3. Enable the "YouTube Data API v3" for your project</li>
            <li>4. Go to Credentials and create an API key</li>
            <li>5. Copy the API key and paste it here</li>
          </ol>
          <p className="text-xs text-muted-foreground mt-4">
            Note: The YouTube Data API has usage quotas. For high-volume usage, consider implementing rate limiting.
          </p>
        </div>
      </div>
      
      <div className="pt-6 border-t border-border space-y-4">
        <h2 className="text-lg font-semibold">OpenAI API Key</h2>
        <p className="text-sm text-muted-foreground">
          To use AI analysis features, you need to provide an OpenAI API Key.{' '}
          <a 
            href="https://platform.openai.com/api-keys" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline inline-flex items-center"
          >
            Get your key <ExternalLink className="h-3 w-3 ml-1" />
          </a>
        </p>
        
        <div className="grid gap-2">
          <div className="flex items-center">
            <label htmlFor="openai-api-key" className="text-sm font-medium mr-2">
              API Key
            </label>
          </div>
          
          <div className="relative">
            <Input
              id="openai-api-key"
              value={openAIKey}
              onChange={handleOpenAIKeyChange}
              type={showApiKey ? "text" : "password"}
              placeholder="sk-..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          
          <Button 
            onClick={saveOpenAIKey} 
            className="w-full"
          >
            Save OpenAI API Key
          </Button>
          
          <p className="text-xs text-muted-foreground mt-1">
            Your API key is stored locally in your browser and never sent to our servers.
          </p>
        </div>
      </div>
    </div>
  )
} 