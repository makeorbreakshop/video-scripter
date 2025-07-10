'use client'

import React, { useState, useEffect } from 'react'
import { TrendingUp, Eye, ThumbsUp, Calendar, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDistanceToNow } from 'date-fns'

interface OutlierExamplesProps {
  topic: any
  onSelectOutlier: (outlier: any) => void
  onNext: () => void
}

interface VideoOutlier {
  id: string
  title: string
  channel: string
  views: number
  likes: number
  engagement_rate: number
  published_at: string
  thumbnail_url: string
  outlier_score: number
  outlier_reason: string
}

export default function OutlierExamples({ topic, onSelectOutlier, onNext }: OutlierExamplesProps) {
  const [outliers, setOutliers] = useState<VideoOutlier[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOutlier, setSelectedOutlier] = useState<VideoOutlier | null>(null)
  const [activeTab, setActiveTab] = useState('recent')

  useEffect(() => {
    fetchOutliers()
  }, [topic])

  const fetchOutliers = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/planning/get-outliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          topic: topic.query,
          timeframe: activeTab 
        })
      })
      const data = await response.json()
      setOutliers(data.outliers || [])
    } catch (error) {
      console.error('Failed to fetch outliers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectOutlier = (outlier: VideoOutlier) => {
    setSelectedOutlier(outlier)
    onSelectOutlier(outlier)
  }

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Successful Examples</CardTitle>
          <CardDescription>
            Videos about "{topic.query}" that performed exceptionally well
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); fetchOutliers() }}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="recent">Recent (30 days)</TabsTrigger>
              <TabsTrigger value="quarter">Last Quarter</TabsTrigger>
              <TabsTrigger value="all">All Time</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-6">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {outliers.map((outlier) => (
                    <Card
                      key={outlier.id}
                      className={`cursor-pointer transition-all hover:shadow-lg ${
                        selectedOutlier?.id === outlier.id ? 'ring-2 ring-blue-500' : ''
                      }`}
                      onClick={() => handleSelectOutlier(outlier)}
                    >
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                          <img
                            src={outlier.thumbnail_url}
                            alt={outlier.title}
                            className="h-24 w-40 rounded object-cover"
                          />
                          <div className="flex-1 space-y-2">
                            <h3 className="font-medium line-clamp-2">{outlier.title}</h3>
                            <p className="text-sm text-gray-600">{outlier.channel}</p>
                            <div className="flex items-center gap-4 text-sm">
                              <span className="flex items-center gap-1">
                                <Eye className="h-3 w-3" />
                                {formatNumber(outlier.views)}
                              </span>
                              <span className="flex items-center gap-1">
                                <ThumbsUp className="h-3 w-3" />
                                {formatNumber(outlier.likes)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDistanceToNow(new Date(outlier.published_at), { addSuffix: true })}
                              </span>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              <TrendingUp className="mr-1 h-3 w-3" />
                              {outlier.outlier_reason}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {selectedOutlier && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Selected for inspiration:</p>
                <p className="font-medium">{selectedOutlier.title}</p>
              </div>
              <Button onClick={onNext}>
                Continue to Patterns
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}