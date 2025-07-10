'use client'

import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { 
  Brain, 
  Lightbulb, 
  Target, 
  Sparkles, 
  TrendingUp,
  AlertCircle,
  ChevronRight,
  Wand2,
  BarChart3,
  FileText,
  Palette
} from 'lucide-react'

interface VideoData {
  id: string
  title: string
  viewCount: number
  performanceRatio: number
  topic: string
  thumbnail: string
}

interface AIInsightsPanelProps {
  videos: VideoData[]
  selectedVideo: VideoData | null
  onGenerateIdea: (idea: any) => void
}

export function AIInsightsPanel({ videos, selectedVideo, onGenerateIdea }: AIInsightsPanelProps) {
  const [activeTab, setActiveTab] = useState('patterns')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [insights, setInsights] = useState<any>(null)
  
  // Simulate AI analysis
  useEffect(() => {
    if (selectedVideo) {
      setIsAnalyzing(true)
      // Simulate API call
      setTimeout(() => {
        setInsights({
          patterns: extractPatterns(selectedVideo, videos),
          opportunities: findOpportunities(selectedVideo, videos),
          predictions: makePredictions(selectedVideo, videos)
        })
        setIsAnalyzing(false)
      }, 1500)
    }
  }, [selectedVideo, videos])
  
  return (
    <Card className="bg-black/90 backdrop-blur border-gray-700 overflow-hidden">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-500" />
            AI Insights Engine
          </h3>
          <Badge variant="outline" className="text-xs">
            Powered by Claude & GPT-4
          </Badge>
        </div>
        {isAnalyzing && (
          <div className="space-y-2">
            <Progress value={66} className="h-1" />
            <p className="text-xs text-gray-400">Analyzing patterns...</p>
          </div>
        )}
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="p-4">
        <TabsList className="grid w-full grid-cols-3 bg-gray-900">
          <TabsTrigger value="patterns" className="text-xs">
            <BarChart3 className="w-3 h-3 mr-1" />
            Patterns
          </TabsTrigger>
          <TabsTrigger value="opportunities" className="text-xs">
            <Target className="w-3 h-3 mr-1" />
            Opportunities
          </TabsTrigger>
          <TabsTrigger value="predictions" className="text-xs">
            <TrendingUp className="w-3 h-3 mr-1" />
            Predictions
          </TabsTrigger>
        </Tabs>
        
        <AnimatePresence mode="wait">
          {insights && (
            <>
              <TabsContent value="patterns" className="space-y-3 mt-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {insights.patterns.map((pattern: any, i: number) => (
                    <PatternCard key={i} pattern={pattern} onApply={onGenerateIdea} />
                  ))}
                </motion.div>
              </TabsContent>
              
              <TabsContent value="opportunities" className="space-y-3 mt-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  {insights.opportunities.map((opp: any, i: number) => (
                    <OpportunityCard key={i} opportunity={opp} />
                  ))}
                </motion.div>
              </TabsContent>
              
              <TabsContent value="predictions" className="space-y-3 mt-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <PredictionView predictions={insights.predictions} />
                </motion.div>
              </TabsContent>
            </>
          )}
        </AnimatePresence>
      </Tabs>
    </Card>
  )
}

function PatternCard({ pattern, onApply }: any) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="p-3 bg-gray-900/50 rounded-lg border border-gray-800 hover:border-purple-500/50 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${pattern.strength === 'high' ? 'bg-green-500' : 'bg-yellow-500'}`} />
          <h4 className="text-sm font-medium">{pattern.name}</h4>
        </div>
        <Badge variant="outline" className="text-xs">
          {pattern.confidence}% match
        </Badge>
      </div>
      <p className="text-xs text-gray-400 mb-3">{pattern.description}</p>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="w-3 h-3 text-gray-500" />
          <code className="text-xs bg-gray-800 px-2 py-1 rounded font-mono">
            {pattern.formula}
          </code>
        </div>
        {pattern.examples && (
          <div className="text-xs text-gray-500">
            Examples: {pattern.examples.join(', ')}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full mt-3 text-xs"
        onClick={() => onApply(pattern)}
      >
        <Wand2 className="w-3 h-3 mr-1" />
        Apply Pattern
      </Button>
    </motion.div>
  )
}

function OpportunityCard({ opportunity }: any) {
  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="p-3 bg-gray-900/50 rounded-lg border border-gray-800"
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${
          opportunity.type === 'gap' ? 'bg-blue-500/20' : 'bg-green-500/20'
        }`}>
          {opportunity.type === 'gap' ? (
            <AlertCircle className="w-4 h-4 text-blue-400" />
          ) : (
            <Lightbulb className="w-4 h-4 text-green-400" />
          )}
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium mb-1">{opportunity.title}</h4>
          <p className="text-xs text-gray-400">{opportunity.description}</p>
          {opportunity.action && (
            <Button size="sm" variant="ghost" className="mt-2 text-xs p-0 h-auto">
              {opportunity.action}
              <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function PredictionView({ predictions }: any) {
  return (
    <div className="space-y-4">
      <div className="p-4 bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/20">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            Performance Prediction
          </h4>
          <Badge className="bg-purple-500/20 text-purple-300">
            {predictions.confidence}% confidence
          </Badge>
        </div>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-400">Predicted Views (30 days)</span>
              <span className="font-medium">{predictions.viewRange}</span>
            </div>
            <Progress value={75} className="h-2" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-gray-400 text-xs">Best Time</div>
              <div className="font-medium">{predictions.bestTime}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">Optimal Length</div>
              <div className="font-medium">{predictions.optimalLength}</div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="space-y-2">
        <h5 className="text-sm font-medium flex items-center gap-2">
          <Palette className="w-4 h-4 text-pink-400" />
          Thumbnail Recommendations
        </h5>
        {predictions.thumbnailTips.map((tip: string, i: number) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <div className="w-1 h-1 rounded-full bg-pink-400 mt-1.5" />
            <span className="text-gray-400">{tip}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Helper functions to generate insights
function extractPatterns(video: VideoData, allVideos: VideoData[]) {
  return [
    {
      name: "Number + Result Formula",
      description: "Titles starting with numbers perform 2.3x better",
      formula: "[Number] + [Action] + [Result]",
      examples: ["5 Ways to...", "10 Tips for..."],
      confidence: 87,
      strength: 'high'
    },
    {
      name: "Question Hook",
      description: "Questions in titles increase CTR by 45%",
      formula: "Why/How [Surprising Statement]?",
      examples: ["Why This Works?", "How I Did It?"],
      confidence: 72,
      strength: 'medium'
    }
  ]
}

function findOpportunities(video: VideoData, allVideos: VideoData[]) {
  return [
    {
      type: 'gap',
      title: 'Content Gap Detected',
      description: 'No videos cover "advanced techniques" in this topic',
      action: 'Create advanced guide'
    },
    {
      type: 'trend',
      title: 'Rising Topic Combination',
      description: `${video.topic} + AI is trending up 340% this month`,
      action: 'Explore AI angle'
    }
  ]
}

function makePredictions(video: VideoData, allVideos: VideoData[]) {
  return {
    confidence: 82,
    viewRange: '15K - 22K',
    bestTime: 'Tuesday 2PM EST',
    optimalLength: '8-12 minutes',
    thumbnailTips: [
      'Use high contrast colors (yellow/blue)',
      'Include a face showing emotion',
      'Add result visualization',
      'Keep text under 4 words'
    ]
  }
}