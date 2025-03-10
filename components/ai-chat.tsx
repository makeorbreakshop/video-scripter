"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, Loader2, Database, FileText, Scroll, DollarSign, Settings } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

interface Source {
  type: 'youtube' | 'research' | 'script';
  id: string;
  title: string;
  timestamp?: number;
}

interface Message {
  role: "user" | "assistant"
  content: string
  timestamp: Date
  sources?: Source[]
  usage?: UsageInfo
}

interface UsageInfo {
  model: string
  modelName: string
  inputTokens: number
  outputTokens: number
  inputCost: number
  outputCost: number
  totalCost: number
}

// Model options for the UI
const MODEL_OPTIONS = [
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    description: 'Fastest, lowest cost',
    inputPrice: '$0.25/M tokens',
    outputPrice: '$1.25/M tokens',
  },
  {
    id: 'claude-3-5-sonnet-20240620',
    name: 'Claude 3.5 Sonnet',
    description: 'Latest model with advanced capabilities',
    inputPrice: '$3/M tokens',
    outputPrice: '$15/M tokens',
  },
  {
    id: 'claude-3-sonnet-20240229',
    name: 'Claude 3 Sonnet',
    description: 'Original Sonnet model',
    inputPrice: '$3/M tokens',
    outputPrice: '$15/M tokens',
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    description: 'Most powerful, higher cost',
    inputPrice: '$15/M tokens',
    outputPrice: '$75/M tokens',
  },
]

export function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi there! I'm your YouTube script assistant with access to your processed video database. I can answer questions about your specific videos or help with scriptwriting. Try asking me about the content in your videos or for scriptwriting advice!",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [sources, setSources] = useState({
    youtubeVideos: true,
    researchDocs: false,
    currentScript: false,
  })
  const [model, setModel] = useState('claude-3-5-sonnet-20240620')
  const [maxTokens, setMaxTokens] = useState(4000)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [totalCost, setTotalCost] = useState(0)
  const [userId, setUserId] = useState('00000000-0000-0000-0000-000000000000') // Default system user ID
  const [debugInfo, setDebugInfo] = useState<any>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [directTestResults, setDirectTestResults] = useState<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Get user ID from local storage or create a default one on mount
  useEffect(() => {
    // Try to get user ID from localStorage
    const storedUserId = localStorage.getItem('userId')
    if (storedUserId) {
      setUserId(storedUserId)
    } else {
      // Generate a simple UUID if none exists
      const newUserId = '00000000-0000-0000-0000-000000000000'
      localStorage.setItem('userId', newUserId)
      setUserId(newUserId)
    }
  }, [])

  const handleSourceChange = (source: keyof typeof sources) => {
    setSources(prev => ({
      ...prev,
      [source]: !prev[source]
    }))
  }

  const handleModelChange = (value: string) => {
    setModel(value)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    setError(null)
    setDebugInfo(null)

    // Add user message
    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // Format previous messages for context (limited to last 10 for efficiency)
      const previousMessages = messages
        .slice(-10)
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      
      // Call the API with the RAG system
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: input,
          sources,
          conversationId,
          previousMessages,
          model,
          maxTokens,
          userId,
          returnDebugInfo: true, // Request debug info
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to get response from AI")
      }

      const data = await response.json()
      
      // Save debug info
      if (data.debugInfo) {
        setDebugInfo(data.debugInfo)
        console.log("Debug info:", data.debugInfo)
      }
      
      // Save conversation ID if we don't have one yet
      if (data.conversationId && !conversationId) {
        setConversationId(data.conversationId)
      }

      // Update total cost
      if (data.usage?.totalCost) {
        setTotalCost(prev => prev + data.usage.totalCost)
      }

      // Add assistant message with response
      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        sources: data.sources,
        usage: data.usage,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error("Error calling AI chat API:", error)
      setError(error instanceof Error ? error.message : "An unknown error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  // Format timestamp from seconds to MM:SS
  const formatTimestamp = (seconds?: number): string => {
    if (!seconds) return 'N/A';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  // Format cost to 4 decimal places with dollar sign
  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(4)}`;
  }

  // Render citation badges for sources
  const renderSourceBadges = (sources?: Source[]) => {
    if (!sources || sources.length === 0) return null;
    
    return (
      <div className="flex flex-wrap gap-1 mt-2">
        {sources.map((source, index) => (
          <span 
            key={index}
            className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-primary/10 text-primary"
          >
            {source.type === 'youtube' && <Database className="h-3 w-3 mr-1" />}
            {source.type === 'research' && <FileText className="h-3 w-3 mr-1" />}
            {source.type === 'script' && <Scroll className="h-3 w-3 mr-1" />}
            {source.title}
            {source.timestamp && ` (${formatTimestamp(source.timestamp)})`}
          </span>
        ))}
      </div>
    );
  }

  // Render usage information
  const renderUsageInfo = (usage?: UsageInfo) => {
    if (!usage) return null;
    
    return (
      <div className="mt-2 text-xs text-muted-foreground">
        <div className="flex items-center">
          <DollarSign className="h-3 w-3 mr-1" />
          <span>
            {usage.modelName} • {usage.inputTokens + usage.outputTokens} tokens • 
            {' '}{formatCost(usage.totalCost)}
          </span>
        </div>
      </div>
    );
  }

  // Add function to handle "unlimited" option
  const handleUnlimitedToggle = (checked: boolean) => {
    if (checked) {
      setMaxTokens(4000); // Set to near maximum
    } else {
      setMaxTokens(1024); // Set to more conservative default
    }
  };

  // New function to toggle debug panel
  const toggleDebug = () => {
    setShowDebug(prev => !prev)
  }

  // Function to directly test the vector search
  const runDirectVectorTest = async () => {
    if (!input.trim()) {
      setError("Please enter a search query first");
      return;
    }
    
    try {
      const response = await fetch("/api/debug/vector-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: input,
        }),
      });
      
      if (!response.ok) {
        throw new Error("Vector test failed");
      }
      
      const data = await response.json();
      setDirectTestResults(data);
      setShowDebug(true);
      
      console.log("Direct vector test results:", data);
    } catch (error) {
      console.error("Error running direct vector test:", error);
      setError(error instanceof Error ? error.message : "An unknown error occurred");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with model selection and cost */}
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">AI Chat</h3>
          <div className="flex items-center space-x-2">
            <div className="text-xs text-muted-foreground">
              Total cost: {formatCost(totalCost)}
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 px-2 bg-amber-200 hover:bg-amber-300 text-black"
              onClick={toggleDebug}
            >
              <span className="text-xs">🐞 Debug</span>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7">
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm">Model Settings</h4>
                  <div className="space-y-2">
                    <Label htmlFor="model-selection">Model</Label>
                    <RadioGroup 
                      id="model-selection" 
                      value={model}
                      onValueChange={handleModelChange}
                      className="space-y-2"
                    >
                      {MODEL_OPTIONS.map(option => (
                        <div key={option.id} className="flex items-start space-x-2">
                          <RadioGroupItem value={option.id} id={option.id} />
                          <div className="grid gap-0.5">
                            <Label htmlFor={option.id} className="text-sm font-medium">
                              {option.name}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {option.description} • Input: {option.inputPrice} • Output: {option.outputPrice}
                            </p>
                          </div>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label htmlFor="max-tokens">Max Output Tokens: {maxTokens}</Label>
                      <span className="text-xs text-muted-foreground">
                        (~{Math.round(maxTokens * 0.75)} words)
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-2 mb-2">
                      <Switch 
                        id="unlimited-toggle"
                        checked={maxTokens >= 4000}
                        onCheckedChange={handleUnlimitedToggle}
                      />
                      <Label htmlFor="unlimited-toggle">Full answers (higher cost)</Label>
                    </div>
                    
                    {maxTokens < 4000 && (
                      <Slider
                        id="max-tokens"
                        min={256}
                        max={4000}
                        step={256}
                        value={[maxTokens]}
                        onValueChange={(value) => setMaxTokens(value[0])}
                      />
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        
        {/* Debug controls - always visible */}
        <div className="bg-amber-100 dark:bg-amber-900/30 p-2 rounded-md mb-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Debugging Tools</span>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                className="h-7 bg-blue-500 hover:bg-blue-600"
                onClick={toggleDebug}
              >
                {showDebug ? 'Hide Debug Panel' : 'Show Debug Panel'}
              </Button>
              <Button 
                size="sm" 
                className="h-7 bg-green-500 hover:bg-green-600"
                onClick={runDirectVectorTest}
              >
                Test Vector Search
              </Button>
            </div>
          </div>
        </div>
        
        <h3 className="text-sm font-medium mb-2">Search Sources:</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-center space-x-2">
            <Switch 
              id="youtube-source" 
              checked={sources.youtubeVideos}
              onCheckedChange={() => handleSourceChange('youtubeVideos')}
            />
            <Label htmlFor="youtube-source">YouTube Videos</Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch 
              id="research-source" 
              checked={sources.researchDocs}
              onCheckedChange={() => handleSourceChange('researchDocs')}
            />
            <Label htmlFor="research-source">Research Documents</Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Switch 
              id="script-source" 
              checked={sources.currentScript}
              onCheckedChange={() => handleSourceChange('currentScript')}
            />
            <Label htmlFor="script-source">Current Script</Label>
          </div>
        </div>
      </div>

      {/* Debug panel */}
      {showDebug && (
        <div className="border-b border-border p-3 bg-slate-100 dark:bg-slate-900 text-xs overflow-auto max-h-96">
          <h4 className="font-bold mb-2 text-base">Debug Information</h4>
          
          {/* Direct test results */}
          {directTestResults ? (
            <div className="mb-4 border-b pb-2">
              <h5 className="font-bold text-blue-600">Direct Vector Test Results</h5>
              <p>Total chunks in DB: {directTestResults.totalChunksInDb}</p>
              
              <div className="mt-2">
                <h6 className="font-semibold">Normal Search (with auth):</h6>
                <p>Results: {directTestResults.normalResultsCount}</p>
                {directTestResults.normalError && (
                  <p className="text-red-500">Error: {directTestResults.normalError}</p>
                )}
              </div>
              
              <div className="mt-2">
                <h6 className="font-semibold">Direct Query:</h6>
                <p>Results: {directTestResults.directResultsCount}</p>
                {directTestResults.directError && (
                  <p className="text-red-500">Error: {directTestResults.directError}</p>
                )}
                {directTestResults.directResultsCount > 0 && (
                  <div>
                    <p className="font-semibold">Sample data:</p>
                    <pre className="bg-slate-200 dark:bg-slate-800 p-1 rounded text-xs overflow-auto mt-1">
                      {JSON.stringify(directTestResults.directResults[0], null, 2).substring(0, 200) + '...'}
                    </pre>
                  </div>
                )}
              </div>
              
              <div className="mt-2">
                <h6 className="font-semibold">No-Auth Function:</h6>
                <p>Results: {directTestResults.noAuthResultsCount}</p>
                {directTestResults.noAuthError && (
                  <p className="text-red-500">Error: {directTestResults.noAuthError}</p>
                )}
              </div>
            </div>
          ) : <p>No direct test results yet. Click "Test Vector Search" to test the database connection.</p>}
          
          {/* Regular debug info */}
          {debugInfo && (
            <div>
              <div className="mb-2">
                <p className="font-semibold">User ID: {userId}</p>
                <p className="font-semibold">Search Results: {debugInfo.searchResults?.length || 0} found</p>
              </div>
              
              {debugInfo.searchResults && debugInfo.searchResults.length > 0 ? (
                <div>
                  <h5 className="font-semibold">Search Results:</h5>
                  <ul className="list-disc pl-4">
                    {debugInfo.searchResults.map((result: any, idx: number) => (
                      <li key={idx} className="mb-1">
                        <div><span className="font-medium">Video:</span> {result.metadata?.title || 'Unknown'}</div>
                        <div><span className="font-medium">Similarity:</span> {result.similarity?.toFixed(4)}</div>
                        <div className="truncate"><span className="font-medium">Content:</span> {result.content?.substring(0, 100)}...</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-amber-500">No matching content found in database for this query.</p>
              )}
              
              {debugInfo.systemPrompt && (
                <div className="mt-2">
                  <h5 className="font-semibold">System Prompt:</h5>
                  <pre className="bg-slate-200 dark:bg-slate-800 p-2 rounded text-xs overflow-auto mt-1">
                    {debugInfo.systemPrompt}
                  </pre>
                </div>
              )}
              
              {debugInfo.error && (
                <div className="mt-2 text-red-500">
                  <h5 className="font-semibold">Error:</h5>
                  <pre className="bg-red-100 dark:bg-red-900 p-2 rounded text-xs overflow-auto mt-1">
                    {debugInfo.error}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div key={index} className={`flex ${message.role === "assistant" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[85%] rounded-lg p-3 ${
                message.role === "assistant" ? "bg-secondary text-foreground" : "bg-primary/10 text-foreground"
              }`}
            >
              <div className="flex items-center mb-1">
                {message.role === "assistant" ? (
                  <Bot className="h-3 w-3 mr-2 text-muted-foreground" />
                ) : (
                  <User className="h-3 w-3 mr-2 text-muted-foreground" />
                )}
                <span className="text-xs text-muted-foreground">
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              
              {/* Show sources if available */}
              {renderSourceBadges(message.sources)}
              
              {/* Show usage information */}
              {renderUsageInfo(message.usage)}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg p-3 bg-secondary text-foreground">
              <div className="flex items-center">
                <Bot className="h-3 w-3 mr-2 text-muted-foreground" />
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Chat input */}
      <div className="border-t border-border p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your videos or scripts..."
            className="flex-1 h-9 bg-secondary rounded-md px-3 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="h-9 w-9 rounded-md bg-primary flex items-center justify-center disabled:opacity-50"
          >
            <Send className="h-4 w-4 text-primary-foreground" />
          </button>
        </form>
      </div>
    </div>
  )
}

