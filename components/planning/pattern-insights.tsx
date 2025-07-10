'use client'

import React, { useState, useEffect } from 'react'
import { Lightbulb, TrendingUp, Target, Clock, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface PatternInsightsProps {
  topic: any
  selectedOutlier?: any
  onSelectPattern: (pattern: any) => void
  onNext: () => void
}

interface Pattern {
  id: string
  type: 'title' | 'hook' | 'structure' | 'timing' | 'style'
  name: string
  description: string
  examples: string[]
  success_rate: number
  avg_performance: {
    views: number
    engagement: number
  }
  insights: string[]
}

export default function PatternInsights({ topic, selectedOutlier, onSelectPattern, onNext }: PatternInsightsProps) {
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPatterns, setSelectedPatterns] = useState<Pattern[]>([])

  useEffect(() => {
    fetchPatterns()
  }, [topic, selectedOutlier])

  const fetchPatterns = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/planning/analyze-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          topic: topic.query,
          outlier: selectedOutlier
        })
      })
      const data = await response.json()
      setPatterns(data.patterns || [])
    } catch (error) {
      console.error('Failed to fetch patterns:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectPattern = (pattern: Pattern) => {
    const isSelected = selectedPatterns.find(p => p.id === pattern.id)
    if (isSelected) {
      setSelectedPatterns(selectedPatterns.filter(p => p.id !== pattern.id))
    } else {
      setSelectedPatterns([...selectedPatterns, pattern])
    }
  }

  const handleContinue = () => {
    onSelectPattern(selectedPatterns)
    onNext()
  }

  const getPatternIcon = (type: string) => {
    switch (type) {
      case 'title': return <Target className="h-4 w-4" />
      case 'hook': return <TrendingUp className="h-4 w-4" />
      case 'structure': return <Lightbulb className="h-4 w-4" />
      case 'timing': return <Clock className="h-4 w-4" />
      default: return <Lightbulb className="h-4 w-4" />
    }
  }

  const getPatternColor = (type: string) => {
    switch (type) {
      case 'title': return 'bg-blue-100 text-blue-800'
      case 'hook': return 'bg-green-100 text-green-800'
      case 'structure': return 'bg-purple-100 text-purple-800'
      case 'timing': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Success Patterns</CardTitle>
          <CardDescription>
            Common patterns found in high-performing "{topic.query}" videos
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {patterns.map((pattern) => (
                <Card
                  key={pattern.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedPatterns.find(p => p.id === pattern.id) ? 'ring-2 ring-blue-500' : ''
                  }`}
                  onClick={() => handleSelectPattern(pattern)}
                >
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Badge className={getPatternColor(pattern.type)}>
                            {getPatternIcon(pattern.type)}
                            <span className="ml-1">{pattern.type}</span>
                          </Badge>
                          <h3 className="font-medium">{pattern.name}</h3>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-medium">{pattern.success_rate}% success rate</p>
                          <p className="text-gray-600">
                            Avg. {(pattern.avg_performance.views / 1000).toFixed(0)}K views
                          </p>
                        </div>
                      </div>

                      <p className="text-sm text-gray-600">{pattern.description}</p>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-700">Examples:</p>
                        <ul className="space-y-1">
                          {pattern.examples.slice(0, 2).map((example, idx) => (
                            <li key={idx} className="text-xs text-gray-600 pl-4 relative">
                              <span className="absolute left-0">•</span>
                              {example}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <p className="text-xs font-medium text-gray-700">Key Insights:</p>
                        <div className="flex flex-wrap gap-2">
                          {pattern.insights.map((insight, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {insight}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <Progress value={pattern.success_rate} className="h-2" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPatterns.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Selected patterns:</p>
                <div className="flex gap-2 mt-1">
                  {selectedPatterns.map((pattern) => (
                    <Badge key={pattern.id} variant="secondary">
                      {pattern.name}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button onClick={handleContinue}>
                Create Video Plan
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}