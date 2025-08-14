"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RefreshCw, Activity, Clock, CheckCircle, XCircle, AlertCircle, Users, Zap, Database, Image, Play, Square, TrendingUp, AlertTriangle, Info, FileText } from "lucide-react"
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

interface ViewTrackingStats {
  tierDistribution: { tier: number; count: number }[]
  todayProgress: {
    videosTracked: number
    apiCallsUsed: number
  }
  quotaUsage: {
    today: number
    estimatedDaily: number
    estimatedDailyCalls: number
  }
  recentJobs: any[]
  topVelocityVideos: any[]
  willTrackByTier: Record<number, number>
  totalWillTrack: number
  lastUpdated: string
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
  
  // Removed vectorization worker states - not needed anymore
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
  
  // View tracking states
  const [viewTrackingStats, setViewTrackingStats] = useState<ViewTrackingStats | null>(null)
  const [viewTrackingLoading, setViewTrackingLoading] = useState(false)
  const [updateAllLoading, setUpdateAllLoading] = useState(false)
  const [updateAllStats, setUpdateAllStats] = useState<{videosNeedingUpdate: number, estimatedApiCalls: number} | null>(null)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  
  // LLM Summary states
  const [llmSummaryLoading, setLlmSummaryLoading] = useState(false)
  const [llmSummaryProgress, setLlmSummaryProgress] = useState<{
    isRunning: boolean;
    processed: number;
    total: number;
    failed: number;
    percentage: number;
  } | null>(null)

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

  // Removed fetchVectorizationProgress - expensive endpoint removed
  
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
  
  const fetchViewTrackingStats = async () => {
    try {
      setViewTrackingLoading(true)
      const response = await fetch('/api/view-tracking/stats')
      if (response.ok) {
        const data = await response.json()
        console.log('View tracking stats received:', data)
        console.log('Tier distribution:', data.tierDistribution)
        setViewTrackingStats(data)
      }
    } catch (error) {
      console.error('Failed to fetch view tracking stats:', error)
    } finally {
      setViewTrackingLoading(false)
    }
  }
  
  const runViewTracking = async () => {
    try {
      setViewTrackingLoading(true)
      // Use a more reasonable API limit based on new tier system
      // New system needs ~120 API calls for daily requirements (6,000 videos / 50 per call)
      const dailyApiCalls = Math.ceil(viewTrackingStats?.quotaUsage?.estimatedDailyCalls) || 150;
      const response = await fetch('/api/view-tracking/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxApiCalls: dailyApiCalls })
      })
      if (response.ok) {
        const data = await response.json()
        console.log('View tracking response:', data)
        alert(`View tracking started! Job ID: ${data.jobId}\nTracking ${data.estimatedVideos} videos with ${data.maxApiCalls} API calls`)
        
        // Check job status after a moment
        setTimeout(async () => {
          const statusResponse = await fetch(`/api/view-tracking/run?jobId=${data.jobId}`)
          if (statusResponse.ok) {
            const statusData = await statusResponse.json()
            console.log('Job status:', statusData.job)
          }
          fetchViewTrackingStats()
        }, 5000)
      }
    } catch (error) {
      console.error('Failed to run view tracking:', error)
      alert('Failed to start view tracking')
    } finally {
      setViewTrackingLoading(false)
    }
  }
  
  const fetchUpdateAllStats = async () => {
    try {
      const response = await fetch('/api/view-tracking/update-all')
      if (response.ok) {
        const data = await response.json()
        setUpdateAllStats(data)
      } else {
        console.error('Failed to fetch update-all stats:', response.status)
        // Set a default value to show something
        setUpdateAllStats({
          videosNeedingUpdate: 0,
          estimatedApiCalls: 0
        })
      }
    } catch (error) {
      console.error('Failed to fetch update-all stats:', error)
      // Set a default value to show something
      setUpdateAllStats({
        videosNeedingUpdate: 0,
        estimatedApiCalls: 0
      })
    }
  }
  
  const runUpdateAll = async () => {
    // STRONG confirmation to prevent accidental clicks
    const firstConfirm = confirm(`⚠️ WARNING: This will update ALL ${updateAllStats?.videosNeedingUpdate || 'videos'} in the database!\n\nThis will use approximately ${updateAllStats?.estimatedApiCalls || 'thousands of'} API calls.\n\nAre you SURE you want to continue?`);
    
    if (!firstConfirm) {
      return;
    }
    
    const secondConfirm = confirm(`⚠️ FINAL WARNING: This operation will take ${updateAllStats?.estimatedTime || 'hours'} and cannot be easily stopped.\n\nType "YES" to confirm.`) && 
      prompt('Type "YES" to confirm:') === 'YES';
    
    if (!secondConfirm) {
      return;
    }
    
    try {
      setUpdateAllLoading(true)
      const response = await fetch('/api/view-tracking/update-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      if (response.ok) {
        const data = await response.json()
        setRunningJobId(data.jobId)
        alert(`Update all started! Tracking ${data.videosToUpdate} videos. Job ID: ${data.jobId}`)
        // Refresh stats after a moment
        setTimeout(() => {
          fetchViewTrackingStats()
          fetchUpdateAllStats()
        }, 2000)
      }
    } catch (error) {
      console.error('Failed to run update all:', error)
      alert('Failed to start update all')
    } finally {
      setUpdateAllLoading(false)
    }
  }
  
  const cancelJob = async () => {
    if (!runningJobId) return
    
    try {
      const response = await fetch('/api/view-tracking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: runningJobId })
      })
      
      if (response.ok) {
        alert('Job cancellation requested')
        setRunningJobId(null)
        // Refresh stats
        setTimeout(() => {
          fetchViewTrackingStats()
        }, 1000)
      } else {
        const error = await response.json()
        alert(`Failed to cancel job: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to cancel job:', error)
      alert('Failed to cancel job')
    }
  }
  
  const cancelAllStuckJobs = async () => {
    try {
      const response = await fetch('/api/view-tracking/cancel', {
        method: 'DELETE'
      })
      
      if (response.ok) {
        const data = await response.json()
        alert(`Cancelled ${data.count} stuck jobs`)
        // Refresh stats
        fetchViewTrackingStats()
      }
    } catch (error) {
      console.error('Failed to cancel stuck jobs:', error)
    }
  }
  
  const runDebug = async () => {
    try {
      console.log('🔍 Running view tracking debug...')
      const response = await fetch('/api/view-tracking/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await response.json()
      if (response.ok) {
        console.log('✅ Debug complete. Check console for detailed logs.')
        console.log('Debug stats:', data.stats)
      } else {
        console.error('❌ Debug failed:', data.error)
      }
    } catch (error) {
      console.error('❌ Failed to run debug:', error)
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
  
  // LLM Summary functions
  const fetchLlmSummaryProgress = async () => {
    try {
      const response = await fetch('/api/workers/llm-summary/progress')
      if (response.ok) {
        const data = await response.json()
        setLlmSummaryProgress(data)
      }
    } catch (error) {
      console.error('Failed to fetch LLM summary progress:', error)
    }
  }

  const toggleLlmSummaryVectorizationWorker = async (enable: boolean) => {
    setLlmSummaryLoading(true)
    try {
      const response = await fetch('/api/workers/vectorization/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerType: 'llm_summary_vectorization', enabled: enable })
      })
      
      if (response.ok) {
        await fetchWorkerControls()
        await fetchLlmSummaryProgress()
      }
    } catch (error) {
      console.error('Failed to toggle LLM summary vectorization worker:', error)
    } finally {
      setLlmSummaryLoading(false)
    }
  }
  
  const runLlmSummaryBackfill = async () => {
    if (!confirm('This will start processing ~177K videos. Estimated cost: $20.68. Continue?')) {
      return
    }
    
    setLlmSummaryLoading(true)
    try {
      const response = await fetch('/api/workers/llm-summary/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      
      if (response.ok) {
        const data = await response.json()
        alert(`LLM summary backfill started! Job ID: ${data.jobId}\n\nMake sure the worker is running:\nnpm run worker:llm-summary`)
      } else {
        const error = await response.json()
        alert(`Failed to start backfill: ${error.error}`)
      }
    } catch (error) {
      console.error('Failed to start LLM summary backfill:', error)
      alert('Failed to start backfill')
    } finally {
      setLlmSummaryLoading(false)
    }
  }
  

  // Initial load based on active tab
  useEffect(() => {
    if (activeTab === 'queue') {
      fetchQueueStats()
      fetchWorkerControls()
      fetchViewTrackingStats()
      fetchUpdateAllStats()
      fetchLlmSummaryProgress()
    } else if (activeTab === 'quota') {
      fetchQuotaStatus()
    }
  }, [])

  // Poll only active tab data with longer interval
  useEffect(() => {
    const fetchActiveTabData = () => {
      if (activeTab === 'queue') {
        fetchQueueStats()
        fetchWorkerControls()
        fetchViewTrackingStats()
        fetchUpdateAllStats()
        fetchLlmSummaryProgress()
      } else if (activeTab === 'quota') {
        fetchQuotaStatus()
      }
    }

    // Initial fetch when tab changes
    fetchActiveTabData()

    // Poll every 2 minutes instead of 30 seconds
    const interval = setInterval(fetchActiveTabData, 120000)
    return () => clearInterval(interval)
  }, [activeTab])

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
                fetchWorkerControls()
                fetchViewTrackingStats()
                fetchUpdateAllStats()
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

          {/* Removed Vectorization Workers section to reduce IOPS */}

          {/* View Tracking */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <TrendingUp className="w-5 h-5" />
                <span>View Tracking System</span>
              </CardTitle>
              <CardDescription>Track video performance over time</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {viewTrackingStats ? (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Today's Progress</div>
                      <div className="text-2xl font-bold">{viewTrackingStats.todayProgress.videosTracked.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">
                        Using {viewTrackingStats.todayProgress.apiCallsUsed} API calls
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Daily Estimate</div>
                      <div className="text-2xl font-bold">{viewTrackingStats.quotaUsage.estimatedDaily.toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground">
                        ~{viewTrackingStats.quotaUsage.estimatedDailyCalls} API calls
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Last Updated</div>
                      <div className="text-sm font-medium" suppressHydrationWarning>
                        {new Date(viewTrackingStats.lastUpdated).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="grid gap-4 md:grid-cols-3 mt-6">
                    <div className="space-y-2">
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={runViewTracking}
                        disabled={viewTrackingLoading}
                      >
                        {viewTrackingLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        Run Daily Tracking
                      </Button>
                      <div className="text-xs text-muted-foreground text-center">
                        {viewTrackingStats?.totalWillTrack > 0 ? (
                          <>
                            {viewTrackingStats.quotaUsage?.estimatedDaily > viewTrackingStats.totalWillTrack ? (
                              <>
                                Will track: <span className="font-semibold">{viewTrackingStats.totalWillTrack.toLocaleString()}</span> of{' '}
                                <span className="font-semibold">{viewTrackingStats.quotaUsage.estimatedDaily.toLocaleString()}</span> videos
                              </>
                            ) : (
                              <>
                                Will track: <span className="font-semibold">{viewTrackingStats.totalWillTrack.toLocaleString()}</span> videos
                              </>
                            )}
                            <br />
                            API calls: ~{Math.ceil(viewTrackingStats.totalWillTrack / 50).toLocaleString()}
                          </>
                        ) : (
                          'Calculating...'
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Button
                        className="w-full"
                        size="sm"
                        variant="outline"
                        onClick={runUpdateAll}
                        disabled={updateAllLoading}
                      >
                        {updateAllLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                        Update All Stale
                      </Button>
                      <div className="text-xs text-muted-foreground text-center">
                        {updateAllStats && updateAllStats.videosNeedingUpdate !== null ? (
                          <>
                            Will track: <span className="font-semibold">{updateAllStats.videosNeedingUpdate.toLocaleString()}</span> videos
                            <br />
                            API calls: ~{updateAllStats.estimatedApiCalls.toLocaleString()}
                          </>
                        ) : (
                          'Calculating...'
                        )}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Button
                        className="w-full"
                        size="sm"
                        variant="destructive"
                        onClick={runDebug}
                      >
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Debug (Console)
                      </Button>
                      <div className="text-xs text-muted-foreground text-center">
                        Check browser console for<br />detailed debug logs
                      </div>
                    </div>
                  </div>

                  {/* Tier Distribution */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">Priority Tier Distribution</h4>
                      {viewTrackingStats.totalWillTrack > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <span className="text-green-500">→</span> videos to track
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                      {viewTrackingStats.tierDistribution.map(tier => {
                        const willTrack = viewTrackingStats.willTrackByTier?.[tier.tier] || 0;
                        return (
                          <div key={tier.tier} className="rounded-lg bg-muted/50 p-3">
                            <div className="text-xs text-muted-foreground">Tier {tier.tier}</div>
                            <div className="text-lg font-bold">{tier.count.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">
                              {tier.tier === 0 ? 'Every 12 hours (Days 1-7)' :
                               tier.tier === 1 ? 'Daily (Days 8-30)' : 
                               tier.tier === 2 ? 'Every 3 days (Days 31-90)' : 
                               tier.tier === 3 ? 'Weekly (Days 91-365)' : 
                               tier.tier === 4 ? 'Monthly (365+ days)' : 
                               'Unknown'}
                            </div>
                            {willTrack > 0 && (
                              <div className="text-xs text-green-500 mt-1">
                                → {willTrack.toLocaleString()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Recent Jobs */}
                  {viewTrackingStats.recentJobs.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium">Recent Tracking Jobs</h4>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelAllStuckJobs}
                          className="text-xs"
                        >
                          Cancel Stuck Jobs
                        </Button>
                      </div>
                      <div className="space-y-1">
                        {viewTrackingStats.recentJobs.slice(0, 3).map((job: any) => (
                          <div key={job.id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">
                              {new Date(job.created_at).toLocaleString()}
                            </span>
                            <div className="flex items-center gap-2">
                              {job.status === 'completed' && job.videosWithViews > 0 && (
                                <span className="text-xs font-medium text-green-600">
                                  {job.videosWithViews.toLocaleString()} videos
                                </span>
                              )}
                              {job.status === 'processing' && job.data?.progress && (
                                <span className="text-xs text-muted-foreground">
                                  {job.data.progress}%
                                </span>
                              )}
                              <Badge className={cn(
                                "text-xs",
                                job.status === 'completed' ? "bg-green-100 text-green-800" :
                                job.status === 'processing' ? "bg-blue-100 text-blue-800" :
                                job.status === 'cancelled' ? "bg-gray-100 text-gray-800" :
                                "bg-red-100 text-red-800"
                              )}>
                                {job.status}
                              </Badge>
                              {job.status === 'processing' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    if (confirm('Are you sure you want to cancel this job?')) {
                                      try {
                                        const response = await fetch('/api/view-tracking/cancel', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ jobId: job.id })
                                        })
                                        
                                        if (response.ok) {
                                          alert('Job cancelled successfully')
                                          // Refresh stats
                                          fetchViewTrackingStats()
                                        } else {
                                          alert('Failed to cancel job')
                                        }
                                      } catch (error) {
                                        console.error('Failed to cancel job:', error)
                                        alert('Failed to cancel job')
                                      }
                                    }
                                  }}
                                  className="h-6 px-2 text-xs text-red-600 hover:text-red-800"
                                >
                                  Cancel
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top Priority Videos */}
                  {viewTrackingStats.topVelocityVideos.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium">Highest Priority Videos</h4>
                      <div className="text-xs text-muted-foreground">
                        Top videos by tracking priority score
                      </div>
                      <div className="space-y-1">
                        {viewTrackingStats.topVelocityVideos.slice(0, 5).map((video: any) => (
                          <div key={video.video_id} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate max-w-[200px]">
                              {video.videos?.title || video.video_id}
                            </span>
                            <span className="font-medium">
                              Score: {video.priority_score?.toFixed(1) || 'N/A'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>Loading view tracking stats...</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recovery Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <AlertTriangle className="w-5 h-5" />
                <span>Recovery Actions</span>
              </CardTitle>
              <CardDescription>Fix missing embeddings and classifications from failed imports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Button
                    size="sm"
                    variant="outline" 
                    onClick={async () => {
                      if (confirm('This will generate missing LLM summaries for videos imported in the last 2 hours. Continue?')) {
                        const response = await fetch('/api/workers/llm-summary/run', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ batchSize: 100 })
                        });
                        if (response.ok) {
                          const data = await response.json();
                          alert(`Started summary generation job: ${data.jobId}`);
                        }
                      }
                    }}
                    className="w-full"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Generate Missing Summaries
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    For videos missing LLM summaries from recent imports
                  </div>
                </div>

                <div className="space-y-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (confirm('This will run classification workers for unclassified videos. Continue?')) {
                        // You can add classification worker endpoints here
                        alert('Classification workers would be triggered here');
                      }
                    }}
                    className="w-full"
                  >
                    <Database className="w-4 h-4 mr-2" />
                    Run Classifications
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    Topic and format classification for recent imports
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* LLM Summary Worker */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileText className="w-5 h-5" />
                <span>LLM Summary Generation</span>
              </CardTitle>
              <CardDescription>Generate video summaries and embeddings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {llmSummaryProgress ? (
                <>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Progress</div>
                      <div className="text-2xl font-bold">
                        {(llmSummaryProgress.processed || 0).toLocaleString()} / {(llmSummaryProgress.total || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(llmSummaryProgress.percentage || 0).toFixed(1)}% complete
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Status</div>
                      <div className="text-lg font-medium">
                        {llmSummaryProgress.isRunning ? 'Running' : 'Stopped'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {llmSummaryProgress.failed || 0} failed
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Actions</div>
                      <div className="flex flex-col gap-2">
                        <Button
                          size="sm"
                          onClick={runLlmSummaryBackfill}
                          disabled={llmSummaryLoading || llmSummaryProgress.isRunning}
                          className="w-full"
                        >
                          {llmSummaryLoading && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                          Start Summary Generation
                        </Button>
                      </div>
                    </div>
                  </div>

                  {(llmSummaryProgress.total || 0) > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Completion Progress</span>
                        <span className="font-medium">{(llmSummaryProgress.percentage || 0).toFixed(1)}%</span>
                      </div>
                      <Progress value={llmSummaryProgress.percentage || 0} className="h-3" />
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
                  <p>Loading summary generation status...</p>
                </div>
              )}
            </CardContent>
          </Card>
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