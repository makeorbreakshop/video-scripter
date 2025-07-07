'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Loader2, Play, CheckCircle, XCircle, Clock } from 'lucide-react'

interface BackgroundJob {
  id: string
  job_type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  started_at?: string
  completed_at?: string
  error_message?: string
  metadata: {
    processed_channels?: number
    total_channels?: number
    processed_videos?: number
    progress_percentage?: number
    current_channel?: string
    exclude_shorts?: boolean
  }
}

export default function BaselineCalculationManager() {
  const [currentJob, setCurrentJob] = useState<BackgroundJob | null>(null)
  const [recentJobs, setRecentJobs] = useState<BackgroundJob[]>([])
  const [isStarting, setIsStarting] = useState(false)
  const [isPolling, setIsPolling] = useState(false)

  // Poll for job status updates
  useEffect(() => {
    if (currentJob && (currentJob.status === 'pending' || currentJob.status === 'running')) {
      setIsPolling(true)
      const interval = setInterval(async () => {
        try {
          const response = await fetch(`/api/background-jobs/baseline-calculation?job_id=${currentJob.id}`)
          const data = await response.json()
          
          if (data.job) {
            setCurrentJob(data.job)
            
            // Stop polling when job is complete
            if (data.job.status === 'completed' || data.job.status === 'failed') {
              setIsPolling(false)
              clearInterval(interval)
              
              // Refresh recent jobs list
              fetchRecentJobs()
            }
          }
        } catch (error) {
          console.error('Error polling job status:', error)
        }
      }, 2000) // Poll every 2 seconds

      return () => {
        clearInterval(interval)
        setIsPolling(false)
      }
    }
  }, [currentJob])

  // Fetch recent jobs on component mount
  useEffect(() => {
    fetchRecentJobs()
  }, [])

  const fetchRecentJobs = async () => {
    try {
      const response = await fetch('/api/background-jobs/baseline-calculation')
      const data = await response.json()
      setRecentJobs(data.jobs || [])
    } catch (error) {
      console.error('Error fetching recent jobs:', error)
    }
  }

  const startBaselineCalculation = async () => {
    setIsStarting(true)
    try {
      const response = await fetch('/api/background-jobs/baseline-calculation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          exclude_shorts: true,
          recalculate_all: true
        })
      })

      const data = await response.json()
      
      if (data.success && data.job_id) {
        // Start polling for the new job
        setCurrentJob({
          id: data.job_id,
          job_type: 'baseline_calculation',
          status: 'pending',
          created_at: new Date().toISOString(),
          metadata: { exclude_shorts: true }
        })
      } else {
        alert('Failed to start baseline calculation job')
      }
    } catch (error) {
      console.error('Error starting job:', error)
      alert('Error starting baseline calculation job')
    } finally {
      setIsStarting(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return null
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      pending: 'secondary',
      running: 'default',
      completed: 'default',
      failed: 'destructive'
    } as const

    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status.toUpperCase()}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current Job Status */}
      {currentJob && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {getStatusIcon(currentJob.status)}
              Rolling Baseline Calculation
            </CardTitle>
            <CardDescription>
              Job ID: {currentJob.id}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              {getStatusBadge(currentJob.status)}
              <span className="text-sm text-muted-foreground">
                Started: {currentJob.started_at ? new Date(currentJob.started_at).toLocaleString() : 'Not started'}
              </span>
            </div>

            {currentJob.metadata?.progress_percentage !== undefined && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{currentJob.metadata.progress_percentage}%</span>
                </div>
                <Progress value={currentJob.metadata.progress_percentage} className="w-full" />
                
                {currentJob.metadata.processed_channels !== undefined && (
                  <div className="text-sm text-muted-foreground">
                    Channels: {currentJob.metadata.processed_channels} / {currentJob.metadata.total_channels} | 
                    Videos: {currentJob.metadata.processed_videos || 0}
                  </div>
                )}

                {currentJob.metadata.current_channel && (
                  <div className="text-sm text-muted-foreground">
                    Current: {currentJob.metadata.current_channel}
                  </div>
                )}
              </div>
            )}

            {currentJob.status === 'failed' && currentJob.error_message && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-800">
                  <strong>Error:</strong> {currentJob.error_message}
                </p>
              </div>
            )}

            {currentJob.status === 'completed' && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-800">
                  ✅ Baseline calculation completed successfully!
                  <br />
                  Processed {currentJob.metadata.processed_videos} videos across {currentJob.metadata.processed_channels} channels.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Start New Job */}
      <Card>
        <CardHeader>
          <CardTitle>Recalculate Rolling Baselines</CardTitle>
          <CardDescription>
            Recalculate rolling baseline performance scores for all videos, excluding YouTube Shorts.
            This process runs in the background and may take several minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={startBaselineCalculation}
            disabled={isStarting || (currentJob && (currentJob.status === 'pending' || currentJob.status === 'running'))}
            className="w-full"
          >
            {isStarting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting Calculation...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Start Baseline Recalculation
              </>
            )}
          </Button>
          
          {(currentJob && (currentJob.status === 'pending' || currentJob.status === 'running')) && (
            <p className="text-sm text-muted-foreground mt-2">
              A baseline calculation job is currently running. Please wait for it to complete.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Jobs History */}
      {recentJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
            <CardDescription>
              History of baseline calculation jobs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 border rounded-md">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(job.status)}
                    <div>
                      <p className="text-sm font-medium">
                        {job.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.metadata?.processed_videos && (
                      <span className="text-sm text-muted-foreground">
                        {job.metadata.processed_videos} videos
                      </span>
                    )}
                    {getStatusBadge(job.status)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}