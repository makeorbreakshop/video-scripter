"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RefreshCw, Activity, Clock, CheckCircle, XCircle, AlertCircle, Users, Zap, Database, Image, Play, Square, TrendingUp, AlertTriangle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface QueueStats {
  pending_jobs: number
  processing_jobs: number
  completed_jobs: number
  failed_jobs: number
  total_jobs: number
}

interface Job {
  id: string
  video_id: string
  source: string
  status: 'pending' | 'processing' | 'storing_results' | 'completed' | 'failed'
  priority: number
  created_at: string
  started_at?: string
  completed_at?: string
  worker_id?: string
  error_message?: string
  processing_time?: number
  metadata?: Record<string, unknown>
}

interface VectorizationWorkerStatus {
  type: 'title' | 'thumbnail'
  isRunning: boolean
  startedAt: Date | null
  processedCount: number
  totalCount: number
  remainingCount: number
  errors: number
  uptime: number
}

interface VectorizationProgress {
  total: number
  completed: number
  remaining: number
  percentage: number
}

interface QuotaStatus {
  date?: string
  quota_used: number
  quota_limit: number
  quota_remaining: number
  percentage_used: number
}

interface QuotaCall {
  method: string
  cost: number
  description: string
  created_at: string
  job_id: string | null
}

export default function WorkerDashboard() {
  const [activeTab, setActiveTab] = useState("queue")
  const [queueStats, setQueueStats] = useState<QueueStats>({
    pending_jobs: 0,
    processing_jobs: 0,
    completed_jobs: 0,
    failed_jobs: 0,
    total_jobs: 0
  })
  
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  
  // Vectorization worker states
  const [vectorizationProgress, setVectorizationProgress] = useState<{
    title: VectorizationProgress
    thumbnail: VectorizationProgress
  } | null>(null)
  const [workerControls, setWorkerControls] = useState<{
    title_vectorization: { isEnabled: boolean, lastEnabledAt?: string, lastDisabledAt?: string }
    thumbnail_vectorization: { isEnabled: boolean, lastEnabledAt?: string, lastDisabledAt?: string }
  } | null>(null)
  const [controlsLoading, setControlsLoading] = useState<{
    title: boolean
    thumbnail: boolean
  }>({ title: false, thumbnail: false })

  // Quota states
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null)
  const [recentQuotaCalls, setRecentQuotaCalls] = useState<QuotaCall[]>([])
  const [quotaLoading, setQuotaLoading] = useState(true)

  const fetchQueueStats = async () => {
    try {
      const response = await fetch('/api/worker/queue-stats')
      if (response.ok) {
        const data = await response.json()
        setQueueStats(data.stats)
        setRecentJobs(data.recentJobs || [])
      }
    } catch (error) {
      console.error('Failed to fetch queue stats:', error)
    } finally {
      setIsLoading(false)
      setLastRefresh(new Date())
    }
  }

  const fetchVectorizationProgress = async () => {
    try {
      const response = await fetch('/api/workers/vectorization/progress')
      
      if (response.ok) {
        const data = await response.json()
        setVectorizationProgress(data.progress)
      }
    } catch (error) {
      console.error('Failed to fetch vectorization progress:', error)
    }
  }
  
  const fetchWorkerControls = async () => {
    try {
      const response = await fetch('/api/workers/vectorization/control')
      
      if (response.ok) {
        const data = await response.json()
        setWorkerControls(data.controls)
      }
    } catch (error) {
      console.error('Failed to fetch worker controls:', error)
    }
  }

  const fetchQuotaStatus = async () => {
    try {
      setQuotaLoading(true)
      const response = await fetch('/api/youtube/quota-status')
      if (response.ok) {
        const data = await response.json()
        setQuotaStatus(data.status)
        setRecentQuotaCalls(data.todaysCalls?.slice(0, 20) || [])
      }
    } catch (error) {
      console.error('Failed to fetch quota status:', error)
    } finally {
      setQuotaLoading(false)
    }
  }
  
  const toggleWorker = async (type: 'title' | 'thumbnail', enable: boolean) => {
    const workerType = type === 'title' ? 'title_vectorization' : 'thumbnail_vectorization';
    setControlsLoading(prev => ({ ...prev, [type]: true }));
    
    try {
      const response = await fetch('/api/workers/vectorization/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerType, enabled: enable })
      });
      
      if (response.ok) {
        await fetchWorkerControls();
      } else {
        const error = await response.json();
        console.error(`Failed to ${enable ? 'enable' : 'disable'} ${type} worker:`, error);
      }
    } catch (error) {
      console.error(`Error toggling ${type} worker:`, error);
    } finally {
      setControlsLoading(prev => ({ ...prev, [type]: false }));
    }
  }
  

  useEffect(() => {
    fetchQueueStats()
    fetchVectorizationProgress()
    fetchWorkerControls()
    fetchQuotaStatus()
    const interval = setInterval(() => {
      fetchQueueStats()
      fetchVectorizationProgress()
      fetchWorkerControls()
      fetchQuotaStatus()
    }, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />
      case 'processing':
      case 'storing_results':
        return <Activity className="w-4 h-4 text-blue-500 animate-pulse" />
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: "bg-yellow-100 text-yellow-800",
      processing: "bg-blue-100 text-blue-800",
      storing_results: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800"
    }
    
    return (
      <Badge className={cn("text-xs", variants[status as keyof typeof variants])}>
        {status.replace('_', ' ')}
      </Badge>
    )
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${Math.floor(diffHours / 24)}d ago`
  }
  
  const formatUptime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${mins}m`
  }

  const totalJobs = queueStats.total_jobs || 1
  const completionRate = ((queueStats.completed_jobs / totalJobs) * 100) || 0
  const failureRate = ((queueStats.failed_jobs / totalJobs) * 100) || 0

  const getQuotaAlertLevel = (percentage: number) => {
    if (percentage >= 90) return 'destructive'
    if (percentage >= 75) return 'warning'
    return 'default'
  }

  const getQuotaProgressColor = (percentage: number) => {
    if (percentage >= 90) return 'bg-red-500'
    if (percentage >= 75) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Worker Dashboard</h1>
          <p className="text-muted-foreground">
            Monitor video processing queue and worker performance
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground" suppressHydrationWarning>
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => {
              if (activeTab === 'queue') {
                fetchQueueStats()
                fetchVectorizationProgress()
                fetchWorkerControls()
              } else if (activeTab === 'quota') {
                fetchQuotaStatus()
              } else if (activeTab === 'jobs') {
                fetchQueueStats() // This also fetches recent jobs
              }
            }} 
            disabled={isLoading || quotaLoading}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", (isLoading || quotaLoading) && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">Queue & Workers</TabsTrigger>
          <TabsTrigger value="quota">YouTube Quota</TabsTrigger>
          <TabsTrigger value="jobs">Jobs History</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-6">
          {/* Queue Overview Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Jobs</CardTitle>
                <Clock className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{queueStats.pending_jobs}</div>
                <p className="text-xs text-muted-foreground">Waiting for processing</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Processing</CardTitle>
                <Activity className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{queueStats.processing_jobs}</div>
                <p className="text-xs text-muted-foreground">Currently active</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckCircle className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{queueStats.completed_jobs}</div>
                <p className="text-xs text-muted-foreground">{completionRate.toFixed(1)}% success rate</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Failed</CardTitle>
                <XCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{queueStats.failed_jobs}</div>
                <p className="text-xs text-muted-foreground">{failureRate.toFixed(1)}% failure rate</p>
              </CardContent>
            </Card>
          </div>

          {/* Queue Progress */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center space-x-2">
                  <Zap className="w-5 h-5" />
                  <span>Queue Progress</span>
                </CardTitle>
                <CardDescription>Overall processing status of all jobs</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Completion Rate</span>
                  <span className="font-medium">{completionRate.toFixed(1)}%</span>
                </div>
                <Progress value={completionRate} className="h-3" />
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-sm">Active: {queueStats.processing_jobs}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="text-sm">Pending: {queueStats.pending_jobs}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm">Completed: {queueStats.completed_jobs}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-sm">Failed: {queueStats.failed_jobs}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vectorization Workers */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Title Vectorization Worker */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Database className="w-5 h-5" />
                  <span>Title Vectorization Worker</span>
                </CardTitle>
                <CardDescription>Generates embeddings for video titles</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {workerControls?.title_vectorization?.isEnabled ? (
                      <>
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm font-medium">Enabled</span>
                      </>
                    ) : (
                      <>
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        <span className="text-sm font-medium">Disabled</span>
                      </>
                    )}
                    {workerControls?.title_vectorization?.lastEnabledAt && (
                      <span className="text-xs text-muted-foreground">
                        Last enabled: {formatTimeAgo(workerControls.title_vectorization.lastEnabledAt)}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={workerControls?.title_vectorization?.isEnabled ? "destructive" : "default"}
                    onClick={() => toggleWorker('title', !workerControls?.title_vectorization?.isEnabled)}
                    disabled={controlsLoading.title}
                  >
                    {controlsLoading.title && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                    {workerControls?.title_vectorization?.isEnabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>

                {vectorizationProgress?.title && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Progress</span>
                      <span className="font-medium">{vectorizationProgress.title.percentage.toFixed(0)}%</span>
                    </div>
                    <Progress value={vectorizationProgress.title.percentage} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Total: {vectorizationProgress.title.total.toLocaleString()}</span>
                      <span>Done: {vectorizationProgress.title.completed.toLocaleString()}</span>
                      <span>Left: {vectorizationProgress.title.remaining.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Worker must be running:</p>
                  <code className="text-xs font-mono">npm run worker:title</code>
                </div>
              </CardContent>
            </Card>

            {/* Thumbnail Vectorization Worker */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Image className="w-5 h-5" />
                  <span>Thumbnail Vectorization Worker</span>
                </CardTitle>
                <CardDescription>Generates embeddings for video thumbnails</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {workerControls?.thumbnail_vectorization?.isEnabled ? (
                      <>
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-sm font-medium">Enabled</span>
                      </>
                    ) : (
                      <>
                        <div className="w-2 h-2 rounded-full bg-gray-400" />
                        <span className="text-sm font-medium">Disabled</span>
                      </>
                    )}
                    {workerControls?.thumbnail_vectorization?.lastEnabledAt && (
                      <span className="text-xs text-muted-foreground">
                        Last enabled: {formatTimeAgo(workerControls.thumbnail_vectorization.lastEnabledAt)}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={workerControls?.thumbnail_vectorization?.isEnabled ? "destructive" : "default"}
                    onClick={() => toggleWorker('thumbnail', !workerControls?.thumbnail_vectorization?.isEnabled)}
                    disabled={controlsLoading.thumbnail}
                  >
                    {controlsLoading.thumbnail && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                    {workerControls?.thumbnail_vectorization?.isEnabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>

                {vectorizationProgress?.thumbnail && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Progress</span>
                      <span className="font-medium">{vectorizationProgress.thumbnail.percentage.toFixed(0)}%</span>
                    </div>
                    <Progress value={vectorizationProgress.thumbnail.percentage} className="h-2" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Total: {vectorizationProgress.thumbnail.total.toLocaleString()}</span>
                      <span>Done: {vectorizationProgress.thumbnail.completed.toLocaleString()}</span>
                      <span>Left: {vectorizationProgress.thumbnail.remaining.toLocaleString()}</span>
                    </div>
                  </div>
                )}

                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">Worker must be running:</p>
                  <code className="text-xs font-mono">npm run worker:thumbnail</code>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="quota" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>YouTube API Quota Dashboard</CardTitle>
            </CardHeader>
            <CardContent className="space-y-8">
              {/* Daily Quota Usage Section */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Daily Quota Usage</h3>
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      Resets daily at midnight Pacific Time
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Used</span>
                      <span className="text-2xl font-bold text-green-500">
                        {quotaStatus?.quota_used?.toLocaleString() || '0'} / {quotaStatus?.quota_limit?.toLocaleString() || '10,000'}
                      </span>
                    </div>
                    <Progress 
                      value={quotaStatus?.percentage_used || 0} 
                      className="h-3"
                      style={{
                        background: 'rgb(38, 38, 38)',
                      }}
                    />
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>{quotaStatus?.percentage_used?.toFixed(1) || '0'}% used</span>
                      <span>{quotaStatus?.quota_remaining?.toLocaleString() || '10,000'} remaining</span>
                    </div>
                  </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                    <div className="text-3xl font-bold text-blue-500">{quotaStatus?.quota_used?.toLocaleString() || '0'}</div>
                    <div className="text-sm text-muted-foreground">Used Today</div>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                    <div className="text-3xl font-bold text-green-500">
                      {quotaStatus?.quota_remaining?.toLocaleString() || '10,000'}
                    </div>
                    <div className="text-sm text-muted-foreground">Remaining</div>
                  </div>
                </div>
              </div>

              {/* Recent API Calls */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Recent API Calls</h3>
                  <span className="text-xs text-muted-foreground">
                    Times shown in your local timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </span>
                </div>
                <div className="space-y-0.5">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 px-4 py-2 text-sm font-medium text-muted-foreground">
                    <div className="col-span-2">Time</div>
                    <div className="col-span-2">Method</div>
                    <div className="col-span-1 text-center">Cost</div>
                    <div className="col-span-4">Description</div>
                    <div className="col-span-3 text-right">Job ID</div>
                  </div>
                  
                  {/* Table Body */}
                  {recentQuotaCalls.length > 0 ? (
                    recentQuotaCalls.map((call, index) => {
                      const getMethodColor = (method: string) => {
                        if (method === 'search.list') return 'text-red-500 bg-red-500/10';
                        if (method === 'channels.list') return 'text-green-500 bg-green-500/10';
                        if (method === 'playlistItems.list') return 'text-green-500 bg-green-500/10';
                        return 'text-blue-500 bg-blue-500/10';
                      };
                      
                      return (
                        <div 
                          key={index} 
                          className="grid grid-cols-12 gap-4 px-4 py-2 border-t border-border/50 hover:bg-muted/30 transition-colors items-center"
                        >
                          <div className="col-span-2 text-sm whitespace-nowrap" title={new Date(call.created_at).toLocaleString()}>
                            {new Date(call.created_at).toLocaleTimeString(undefined, { 
                              hour: 'numeric', 
                              minute: '2-digit',
                              hour12: true 
                            })}
                          </div>
                          <div className="col-span-2">
                            <span className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                              getMethodColor(call.method)
                            )}>
                              {call.method}
                            </span>
                          </div>
                          <div className="col-span-1 text-center font-mono text-sm">
                            {call.cost}
                          </div>
                          <div className="col-span-4 text-sm text-muted-foreground truncate">
                            {call.description}
                          </div>
                          <div className="col-span-3 text-right text-xs text-muted-foreground/60 font-mono truncate">
                            {call.job_id || '-'}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 text-center text-muted-foreground">
                      No API calls recorded yet
                    </div>
                  )}
                </div>
              </div>

              {/* Quota Cost Reference */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Quota Cost Reference</h3>
                <div className="text-sm text-muted-foreground">API method costs and import estimates</div>
                
                <div className="grid gap-6 md:grid-cols-2 mt-4">
                  <div>
                    <h4 className="font-semibold mb-3">API Costs</h4>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        channels.list: 1 unit
                      </li>
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        videos.list: 1 unit
                      </li>
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        playlistItems.list: 1 unit
                      </li>
                      <li className="flex items-center text-red-500">
                        <span className="mr-2">•</span>
                        search.list: 100 units ⚠️
                      </li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-3">Import Estimates</h4>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        Small channel (50 videos): ~5 units
                      </li>
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        Medium channel (200 videos): ~10 units
                      </li>
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        Large channel (1000 videos): ~25 units
                      </li>
                      <li className="flex items-center">
                        <span className="text-muted-foreground mr-2">•</span>
                        RSS refresh: ~2 units per channel
                      </li>
                    </ul>
                  </div>
                </div>

                <Alert className="mt-6">
                  <Info className="h-4 w-4" />
                  <AlertTitle>Optimization Success</AlertTitle>
                  <AlertDescription>
                    System now uses playlistItems.list instead of search.list, reducing quota usage by 96%! 
                    You can now import ~900 channels per day vs ~32 previously.
                  </AlertDescription>
                </Alert>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="jobs" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Activity className="w-5 h-5" />
                <span>Recent Jobs History</span>
              </CardTitle>
              <CardDescription>
                Recently processed video import jobs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Jobs Table */}
              <div className="rounded-lg border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Video ID</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Source</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Started</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Duration</th>
                      <th className="px-4 py-3 text-left text-sm font-medium">Worker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentJobs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No recent jobs found
                        </td>
                      </tr>
                    ) : (
                      recentJobs.map((job) => (
                        <tr key={job.id} className="border-b hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-2">
                              {getStatusIcon(job.status)}
                              {getStatusBadge(job.status)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <code className="text-xs font-mono">{job.video_id}</code>
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="outline">{job.source}</Badge>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {job.started_at ? formatTimeAgo(job.started_at) : 'Not started'}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {job.processing_time ? formatDuration(job.processing_time) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            {job.worker_id ? (
                              <code className="text-xs font-mono text-muted-foreground">
                                {job.worker_id.slice(0, 8)}
                              </code>
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Error Details */}
              {recentJobs.some(job => job.status === 'failed') && (
                <div className="mt-6">
                  <h4 className="text-sm font-semibold mb-3">Recent Failures</h4>
                  <div className="space-y-2">
                    {recentJobs
                      .filter(job => job.status === 'failed' && job.error_message)
                      .slice(0, 5)
                      .map((job) => (
                        <Alert key={job.id} variant="destructive">
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>Job {job.id.slice(0, 8)} Failed</AlertTitle>
                          <AlertDescription className="text-xs mt-1">
                            {job.error_message}
                          </AlertDescription>
                        </Alert>
                      ))
                    }
                  </div>
                </div>
              )}

              {/* Summary Stats */}
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-500">
                    {recentJobs.filter(j => j.status === 'completed').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Completed</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-500">
                    {recentJobs.filter(j => j.status === 'processing' || j.status === 'storing_results').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Processing</div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="text-2xl font-bold text-red-500">
                    {recentJobs.filter(j => j.status === 'failed').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Failed</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}