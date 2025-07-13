"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { RefreshCw, Tags, Database, TestTube, Settings, CheckCircle, XCircle, AlertTriangle, Upload, BarChart3, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { LLMClassificationDashboard } from "@/components/llm-classification-dashboard"
import AutoClassificationRunner from "@/components/auto-classification-runner"
import ReclassificationRunner from "@/components/reclassification-runner"

interface ClassificationStats {
  totalVideos: number
  topicClassified: number
  formatClassified: number
  llmUsed: number
  bertopicClusters: number
}

interface SystemStatus {
  bertopicDataLoaded: boolean
  databaseColumns: boolean
  testSystemReady: boolean
}

export default function CategorizationDashboard() {
  const [activeTab, setActiveTab] = useState("overview")
  const [classificationStats, setClassificationStats] = useState<ClassificationStats>({
    totalVideos: 45805,
    topicClassified: 60497,
    formatClassified: 0,
    llmUsed: 0,
    bertopicClusters: 777
  })
  
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    bertopicDataLoaded: false,
    databaseColumns: true,
    testSystemReady: true
  })
  
  const [isLoading, setIsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const fetchClassificationStats = async () => {
    try {
      const response = await fetch('/api/categorization/stats')
      if (response.ok) {
        const data = await response.json()
        setClassificationStats(data.stats)
      }
    } catch (error) {
      console.error('Failed to fetch classification stats:', error)
    } finally {
      setIsLoading(false)
      setLastRefresh(new Date())
    }
  }

  const fetchSystemStatus = async () => {
    try {
      const response = await fetch('/api/categorization/system-status')
      if (response.ok) {
        const data = await response.json()
        setSystemStatus(data.status)
      }
    } catch (error) {
      console.error('Failed to fetch system status:', error)
    }
  }


  useEffect(() => {
    fetchClassificationStats()
    fetchSystemStatus()
    const interval = setInterval(() => {
      fetchClassificationStats()
      fetchSystemStatus()
    }, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [])

  const formatPercentage = (current: number, total: number) => {
    if (total === 0) return '0.0'
    return ((current / total) * 100).toFixed(1)
  }

  const getStatusIcon = (status: boolean) => {
    return status ? (
      <CheckCircle className="w-4 h-4 text-green-500" />
    ) : (
      <XCircle className="w-4 h-4 text-red-500" />
    )
  }

  const getStatusBadge = (status: boolean, label: string) => {
    return (
      <Badge variant={status ? "default" : "destructive"}>
        {status ? "Complete" : label}
      </Badge>
    )
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Video Categorization</h1>
          <p className="text-muted-foreground">
            LLM-powered video classification with batch processing optimization
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
              fetchClassificationStats()
              fetchSystemStatus()
            }} 
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview & Setup</TabsTrigger>
          <TabsTrigger value="classification">Classification Tools</TabsTrigger>
          <TabsTrigger value="analytics">Analytics & Insights</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* System Status Overview */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Videos</CardTitle>
                <Database className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{classificationStats.totalVideos.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">In database</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Topic Classified</CardTitle>
                <Target className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600">
                  {classificationStats.topicClassified.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercentage(classificationStats.topicClassified, classificationStats.totalVideos)}% (historical)
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Format Classified</CardTitle>
                <Tags className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {classificationStats.formatClassified.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatPercentage(classificationStats.formatClassified, classificationStats.totalVideos)}% (needs setup)
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">BERTopic Clusters</CardTitle>
                <BarChart3 className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {classificationStats.bertopicClusters}
                </div>
                <p className="text-xs text-muted-foreground">Available for topic detection</p>
              </CardContent>
            </Card>
          </div>

          {/* System Setup Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="w-5 h-5" />
                <span>System Setup Status</span>
              </CardTitle>
              <CardDescription>Core components needed for video categorization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(systemStatus.bertopicDataLoaded)}
                    <div>
                      <div className="font-medium">BERTopic Data</div>
                      <div className="text-sm text-muted-foreground">777 topic clusters</div>
                    </div>
                  </div>
                  {getStatusBadge(systemStatus.bertopicDataLoaded, "Required")}
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(systemStatus.databaseColumns)}
                    <div>
                      <div className="font-medium">Database Schema</div>
                      <div className="text-sm text-muted-foreground">9 classification columns</div>
                    </div>
                  </div>
                  {getStatusBadge(systemStatus.databaseColumns, "Needed")}
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    {getStatusIcon(systemStatus.testSystemReady)}
                    <div>
                      <div className="font-medium">Test System</div>
                      <div className="text-sm text-muted-foreground">Format detection ready</div>
                    </div>
                  </div>
                  {getStatusBadge(systemStatus.testSystemReady, "Needed")}
                </div>
              </div>

              <Alert>
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertTitle>System Ready</AlertTitle>
                <AlertDescription>
                  LLM-based classification is ready to process videos. Using GPT-4o-mini with batch optimization
                  for cost-effective format detection (~$4-6 for all videos).
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Classification Architecture */}
          <Card>
            <CardHeader>
              <CardTitle>Three-Level Classification Architecture</CardTitle>
              <CardDescription>
                Comprehensive video categorization system with topic, format, and style detection
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-3">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Target className="w-5 h-5 text-blue-500" />
                    <h3 className="font-semibold">Topic (WHAT)</h3>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>• Content subject matter</p>
                    <p>• 777 BERTopic clusters</p>
                    <p>• 3 hierarchical levels</p>
                    <p>• K-nearest neighbor detection</p>
                  </div>
                  <div className="text-xs bg-blue-50 p-2 rounded">
                    Examples: "3D Printing", "Woodworking", "Cooking & Recipes"
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Tags className="w-5 h-5 text-green-500" />
                    <h3 className="font-semibold">Format (HOW)</h3>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>• Presentation structure</p>
                    <p>• Topic-agnostic categories</p>
                    <p>• LLM-based detection</p>
                    <p>• Batch processing (10 videos/call)</p>
                  </div>
                  <div className="text-xs bg-green-50 p-2 rounded">
                    12 formats: Tutorial, Listicle, Explainer, Case Study, News Analysis, Personal Story, Product Focus, Live Stream, Shorts, Vlog, Compilation, Update
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="w-5 h-5 text-purple-500" />
                    <h3 className="font-semibold">Style (STYLISTIC)</h3>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>• Production elements</p>
                    <p>• Multiple tags per video</p>
                    <p>• LLM-based extraction</p>
                    <p>• Future implementation</p>
                  </div>
                  <div className="text-xs bg-purple-50 p-2 rounded">
                    Examples: High production, Quick/Fast, Face in thumbnail
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="classification" className="space-y-6">
          {/* Auto Classification Runner */}
          <AutoClassificationRunner />
          
          {/* Reclassification Runner */}
          <ReclassificationRunner />
          
          {/* LLM-Powered Batch Classification */}
          <LLMClassificationDashboard />
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          {/* Classification Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Classification Progress</CardTitle>
              <CardDescription>
                Overview of video categorization completion status
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Topic Classification</span>
                    <span className="font-medium">
                      {formatPercentage(classificationStats.topicClassified, classificationStats.totalVideos)}%
                    </span>
                  </div>
                  <Progress 
                    value={parseFloat(formatPercentage(classificationStats.topicClassified, classificationStats.totalVideos))} 
                    className="h-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{classificationStats.topicClassified.toLocaleString()} classified</span>
                    <span>{(classificationStats.totalVideos - classificationStats.topicClassified).toLocaleString()} remaining</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Format Classification</span>
                    <span className="font-medium">
                      {formatPercentage(classificationStats.formatClassified, classificationStats.totalVideos)}%
                    </span>
                  </div>
                  <Progress 
                    value={parseFloat(formatPercentage(classificationStats.formatClassified, classificationStats.totalVideos))} 
                    className="h-3"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{classificationStats.formatClassified.toLocaleString()} classified</span>
                    <span>{(classificationStats.totalVideos - classificationStats.formatClassified).toLocaleString()} remaining</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {classificationStats.bertopicClusters}
                  </div>
                  <div className="text-xs text-muted-foreground">Topic Clusters</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">12</div>
                  <div className="text-xs text-muted-foreground">Format Categories</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {classificationStats.llmUsed.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">LLM Reviews</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">$4-6</div>
                  <div className="text-xs text-muted-foreground">Total Cost (65k videos)</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Coming Soon - Analytics Features */}
          <Card>
            <CardHeader>
              <CardTitle>Analytics & Insights</CardTitle>
              <CardDescription>
                Advanced analytics features coming after classification setup is complete
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="p-4 border rounded-lg opacity-50">
                  <h3 className="font-medium mb-2">Cross-Niche Format Analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    Discover which Tutorial formats work across both Furniture and Makeup niches
                  </p>
                </div>
                <div className="p-4 border rounded-lg opacity-50">
                  <h3 className="font-medium mb-2">Topic-Format Heatmap</h3>
                  <p className="text-sm text-muted-foreground">
                    Visualize which format combinations are most common in your niche
                  </p>
                </div>
                <div className="p-4 border rounded-lg opacity-50">
                  <h3 className="font-medium mb-2">Classification Quality Monitor</h3>
                  <p className="text-sm text-muted-foreground">
                    Track accuracy, confidence scores, and LLM usage over time
                  </p>
                </div>
                <div className="p-4 border rounded-lg opacity-50">
                  <h3 className="font-medium mb-2">Edge Case Explorer</h3>
                  <p className="text-sm text-muted-foreground">
                    Browse low-confidence videos that required LLM classification
                  </p>
                </div>
              </div>
              
              <Alert className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Analytics features will be enabled after BERTopic data is loaded and initial classification is complete.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}