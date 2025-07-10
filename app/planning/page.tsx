'use client'

import React, { useState } from 'react'
import { Search, TrendingUp, Lightbulb, Target, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import TopicSearch from '@/components/planning/topic-search'
import OutlierExamples from '@/components/planning/outlier-examples'
import PatternInsights from '@/components/planning/pattern-insights'
import VideoPlan from '@/components/planning/video-plan'

interface VideoTopic {
  query: string
  results?: any[]
  patterns?: any[]
  outliers?: any[]
}

export default function PlanningPage() {
  const [topic, setTopic] = useState<VideoTopic | null>(null)
  const [activeTab, setActiveTab] = useState('search')
  const [videoPlan, setVideoPlan] = useState<any>(null)

  const handleTopicSearch = (searchResults: VideoTopic) => {
    setTopic(searchResults)
    setActiveTab('outliers')
  }

  const handlePatternSelect = (pattern: any) => {
    setVideoPlan({ ...videoPlan, pattern })
    setActiveTab('plan')
  }

  const handleOutlierSelect = (outlier: any) => {
    setVideoPlan({ ...videoPlan, inspiration: outlier })
    setActiveTab('patterns')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Video Planning</h1>
              <p className="text-sm text-gray-600 mt-1">
                Research what works, then plan your video
              </p>
            </div>
            {topic && (
              <div className="text-sm text-gray-600">
                Planning video about: <span className="font-medium text-gray-900">{topic.query}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Progress Bar */}
      {topic && (
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-center space-x-2">
              <div className={`flex items-center ${activeTab === 'search' ? 'text-blue-600' : 'text-gray-900'}`}>
                <Search className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">Topic</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`flex items-center ${activeTab === 'outliers' ? 'text-blue-600' : topic ? 'text-gray-900' : 'text-gray-400'}`}>
                <TrendingUp className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">Examples</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`flex items-center ${activeTab === 'patterns' ? 'text-blue-600' : topic?.outliers ? 'text-gray-900' : 'text-gray-400'}`}>
                <Lightbulb className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">Patterns</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
              <div className={`flex items-center ${activeTab === 'plan' ? 'text-blue-600' : videoPlan ? 'text-gray-900' : 'text-gray-400'}`}>
                <Target className="w-4 h-4 mr-1" />
                <span className="text-sm font-medium">Plan</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="hidden">
            <TabsTrigger value="search">Search</TabsTrigger>
            <TabsTrigger value="outliers">Outliers</TabsTrigger>
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
          </TabsList>

          <TabsContent value="search" className="space-y-6">
            <TopicSearch 
              onSearch={handleTopicSearch}
              existingTopic={topic}
            />
          </TabsContent>

          <TabsContent value="outliers" className="space-y-6">
            {topic && (
              <OutlierExamples 
                topic={topic}
                onSelectOutlier={handleOutlierSelect}
                onNext={() => setActiveTab('patterns')}
              />
            )}
          </TabsContent>

          <TabsContent value="patterns" className="space-y-6">
            {topic && (
              <PatternInsights 
                topic={topic}
                selectedOutlier={videoPlan?.inspiration}
                onSelectPattern={handlePatternSelect}
                onNext={() => setActiveTab('plan')}
              />
            )}
          </TabsContent>

          <TabsContent value="plan" className="space-y-6">
            {videoPlan && (
              <VideoPlan 
                topic={topic!}
                plan={videoPlan}
                onUpdatePlan={setVideoPlan}
              />
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}