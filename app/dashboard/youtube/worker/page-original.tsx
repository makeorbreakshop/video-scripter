"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { RefreshCw, Activity, Clock, CheckCircle, XCircle, AlertCircle, Users, Zap, Database, Image, Play, Square } from "lucide-react"
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

export default function WorkerDashboard() {
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
    const interval = setInterval(() => {
      fetchQueueStats()
      fetchVectorizationProgress()
      fetchWorkerControls()
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
          <Button variant="outline" size="sm" onClick={fetchQueueStats} disabled={isLoading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Queue Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Jobs</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queueStats.pending_jobs}</div>
            <p className="text-xs text-muted-foreground">
              Waiting for processing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Processing</CardTitle>
            <Activity className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queueStats.processing_jobs}</div>
            <p className="text-xs text-muted-foreground">
              Currently active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queueStats.completed_jobs}</div>
            <p className="text-xs text-muted-foreground">
              {completionRate.toFixed(1)}% success rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queueStats.failed_jobs}</div>
            <p className="text-xs text-muted-foreground">
              {failureRate.toFixed(1)}% failure rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Queue Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Queue Progress
          </CardTitle>
          <CardDescription>
            Overall processing status of all jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span>Completion Rate</span>
              <span>{completionRate.toFixed(1)}%</span>
            </div>
            <Progress value={completionRate} className="h-2" />
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span>Active: {queueStats.processing_jobs}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                <span>Pending: {queueStats.pending_jobs}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span>Completed: {queueStats.completed_jobs}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                <span>Failed: {queueStats.failed_jobs}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vectorization Workers */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Title Vectorization Worker */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Title Vectorization Worker
            </CardTitle>
            <CardDescription>
              Generates embeddings for video titles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {workerControls?.title_vectorization?.isEnabled ? (
                      <Activity className="w-4 h-4 text-green-500 animate-pulse" />
                    ) : (
                      <XCircle className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="font-medium">
                      {workerControls?.title_vectorization?.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {workerControls?.title_vectorization?.lastEnabledAt && (
                    <p className="text-xs text-muted-foreground">
                      Last enabled: {formatTimeAgo(workerControls.title_vectorization.lastEnabledAt)}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={workerControls?.title_vectorization?.isEnabled ? "destructive" : "default"}
                  onClick={() => toggleWorker('title', !workerControls?.title_vectorization?.isEnabled)}
                  disabled={controlsLoading.title}
                >
                  {controlsLoading.title ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : workerControls?.title_vectorization?.isEnabled ? (
                    <>
                      <Square className="w-4 h-4 mr-2" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Enable
                    </>
                  )}
                </Button>
              </div>
              
              {vectorizationProgress?.title && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{vectorizationProgress.title.percentage}%</span>
                  </div>
                  <Progress value={vectorizationProgress.title.percentage} className="h-2" />
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>Total: {vectorizationProgress.title.total.toLocaleString()}</div>
                    <div>Done: {vectorizationProgress.title.completed.toLocaleString()}</div>
                    <div>Left: {vectorizationProgress.title.remaining.toLocaleString()}</div>
                  </div>
                </div>
              )}
              
              {!workerControls?.title_vectorization?.isEnabled && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-1">Worker must be running:</p>
                  <code className="text-xs bg-background px-2 py-1 rounded">npm run worker:title</code>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Thumbnail Vectorization Worker */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Image className="w-5 h-5" />
              Thumbnail Vectorization Worker
            </CardTitle>
            <CardDescription>
              Generates embeddings for video thumbnails
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {workerControls?.thumbnail_vectorization?.isEnabled ? (
                      <Activity className="w-4 h-4 text-green-500 animate-pulse" />
                    ) : (
                      <XCircle className="w-4 h-4 text-gray-400" />
                    )}
                    <span className="font-medium">
                      {workerControls?.thumbnail_vectorization?.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {workerControls?.thumbnail_vectorization?.lastEnabledAt && (
                    <p className="text-xs text-muted-foreground">
                      Last enabled: {formatTimeAgo(workerControls.thumbnail_vectorization.lastEnabledAt)}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={workerControls?.thumbnail_vectorization?.isEnabled ? "destructive" : "default"}
                  onClick={() => toggleWorker('thumbnail', !workerControls?.thumbnail_vectorization?.isEnabled)}
                  disabled={controlsLoading.thumbnail}
                >
                  {controlsLoading.thumbnail ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : workerControls?.thumbnail_vectorization?.isEnabled ? (
                    <>
                      <Square className="w-4 h-4 mr-2" />
                      Disable
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Enable
                    </>
                  )}
                </Button>
              </div>
              
              {vectorizationProgress?.thumbnail && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{vectorizationProgress.thumbnail.percentage}%</span>
                  </div>
                  <Progress value={vectorizationProgress.thumbnail.percentage} className="h-2" />
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>Total: {vectorizationProgress.thumbnail.total.toLocaleString()}</div>
                    <div>Done: {vectorizationProgress.thumbnail.completed.toLocaleString()}</div>
                    <div>Left: {vectorizationProgress.thumbnail.remaining.toLocaleString()}</div>
                  </div>
                </div>
              )}
              
              {!workerControls?.thumbnail_vectorization?.isEnabled && (
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm font-medium mb-1">Worker must be running:</p>
                  <code className="text-xs bg-background px-2 py-1 rounded">npm run worker:thumbnail</code>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Recent Jobs
          </CardTitle>
          <CardDescription>
            Latest video processing jobs and their status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No recent jobs found
              </p>
            ) : (
              recentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-4">
                    {getStatusIcon(job.status)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">
                          {job.video_id.length > 50 
                            ? job.video_id.substring(0, 50) + '...' 
                            : job.video_id}
                        </span>
                        {getStatusBadge(job.status)}
                        <Badge variant="outline" className="text-xs">
                          {job.source}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>Created: {formatTimeAgo(job.created_at)}</span>
                        {job.processing_time && (
                          <span>Duration: {formatDuration(job.processing_time)}</span>
                        )}
                        {job.worker_id && (
                          <span>Worker: {job.worker_id.split('-')[0]}</span>
                        )}
                        {job.metadata?.channel_name && (
                          <span className="text-blue-400">{job.metadata.channel_name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="text-xs">
                      Priority: {job.priority}
                    </Badge>
                    {job.error_message && (
                      <Badge variant="destructive" className="text-xs">
                        Error
                      </Badge>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}