/**
 * Tools Page
 * 
 * Centralized location for all application tools including:
 * - YouTube Analytics & API Tools
 * - Daily Channel Monitor
 * - Data Management Tools
 * - API Configuration
 */

'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Youtube, 
  Database, 
  Settings, 
  Rss,
  BarChart3,
  Key,
  Tags
} from 'lucide-react';

// Import the existing YouTube tools component
import { YouTubeToolsTab } from '@/components/youtube/tools-tab';

export default function ToolsPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Tools</h1>
        <p className="text-muted-foreground">
          Manage YouTube analytics, monitor channels, and configure integrations.
        </p>
      </div>

      {/* Tools Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">YouTube Analytics</CardTitle>
            <Youtube className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Active</div>
            <p className="text-xs text-muted-foreground">
              Historical data & reporting
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Channel Monitor</CardTitle>
            <Rss className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">RSS</div>
            <p className="text-xs text-muted-foreground">
              Daily video discovery
            </p>
            <Badge variant="secondary" className="mt-1">Free</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Data Management</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">9K+</div>
            <p className="text-xs text-muted-foreground">
              Videos in database
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">API Integration</CardTitle>
            <Key className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Ready</div>
            <p className="text-xs text-muted-foreground">
              YouTube & AI APIs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Tools Interface */}
      <Tabs defaultValue="youtube" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="youtube" className="flex items-center gap-2">
            <Youtube className="h-4 w-4" />
            YouTube Tools
          </TabsTrigger>
          <TabsTrigger value="categorization" className="flex items-center gap-2">
            <Tags className="h-4 w-4" />
            Categorization
          </TabsTrigger>
          <TabsTrigger value="monitor" className="flex items-center gap-2">
            <Rss className="h-4 w-4" />
            Channel Monitor
          </TabsTrigger>
          <TabsTrigger value="data" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Data Tools
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configuration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="youtube" className="space-y-4">
          <YouTubeToolsTab />
        </TabsContent>

        <TabsContent value="categorization" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Classification Status */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tags className="h-5 w-5" />
                  Classification Status
                </CardTitle>
                <CardDescription>
                  Overview of video categorization progress
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Videos:</span>
                    <span className="font-medium">45,805+</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Classified (Topic):</span>
                    <span className="font-medium text-orange-600">60,497+ (historical)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Classified (Format):</span>
                    <span className="font-medium text-red-600">0 (needs setup)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">LLM Reviews:</span>
                    <span className="font-medium">0</span>
                  </div>
                </div>
                <div className="pt-2 border-t">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">BERTopic Clusters:</span>
                    <Badge variant="outline">777 loaded</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* System Setup */}
            <Card>
              <CardHeader>
                <CardTitle>System Setup</CardTitle>
                <CardDescription>
                  Core setup tasks for categorization system
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">Load BERTopic Data</div>
                      <div className="text-sm text-muted-foreground">Import 777 topic clusters</div>
                    </div>
                    <Badge variant="destructive">Required</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">Test Classification</div>
                      <div className="text-sm text-muted-foreground">Verify system on sample videos</div>
                    </div>
                    <Badge variant="secondary">Ready</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">Database Columns</div>
                      <div className="text-sm text-muted-foreground">9 classification columns added</div>
                    </div>
                    <Badge variant="default">Complete</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Core Tools */}
            <Card>
              <CardHeader>
                <CardTitle>Core Tools</CardTitle>
                <CardDescription>
                  Essential categorization functions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <button className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="text-left">
                    <div className="font-medium">Load BERTopic Clusters</div>
                    <div className="text-sm text-muted-foreground">Import topic detection data</div>
                  </div>
                  <Badge variant="destructive">Critical</Badge>
                </button>
                
                <button className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors opacity-50 cursor-not-allowed">
                  <div className="text-left">
                    <div className="font-medium">Classify Unclassified Videos</div>
                    <div className="text-sm text-muted-foreground">Batch process missing classifications</div>
                  </div>
                  <Badge variant="outline">Needs Data</Badge>
                </button>
                
                <button className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="text-left">
                    <div className="font-medium">Test on Sample Videos</div>
                    <div className="text-sm text-muted-foreground">Run classification test script</div>
                  </div>
                  <Badge variant="default">Ready</Badge>
                </button>
              </CardContent>
            </Card>

            {/* Quality Control */}
            <Card>
              <CardHeader>
                <CardTitle>Quality Control</CardTitle>
                <CardDescription>
                  Monitor and improve classification accuracy
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <button className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors opacity-50 cursor-not-allowed">
                  <div className="text-left">
                    <div className="font-medium">Manual Override</div>
                    <div className="text-sm text-muted-foreground">Fix incorrect classifications</div>
                  </div>
                  <Badge variant="outline">Coming Soon</Badge>
                </button>
                
                <button className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors opacity-50 cursor-not-allowed">
                  <div className="text-left">
                    <div className="font-medium">LLM Usage Monitor</div>
                    <div className="text-sm text-muted-foreground">Track cost (target: &lt;10%)</div>
                  </div>
                  <Badge variant="outline">After Setup</Badge>
                </button>
                
                <button className="w-full flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="text-left">
                    <div className="font-medium">Run Calibration Tool</div>
                    <div className="text-sm text-muted-foreground">Interactive accuracy improvement</div>
                  </div>
                  <Badge variant="secondary">Available</Badge>
                </button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="monitor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Rss className="h-5 w-5" />
                Channel Monitor
              </CardTitle>
              <CardDescription>
                The Daily Channel Monitor is integrated into the YouTube Tools section. 
                Switch to the "YouTube Tools" tab to access RSS-based channel monitoring.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>• Monitor all channels for new videos using RSS feeds</p>
                <p>• 90%+ API quota savings compared to polling YouTube Data API</p>
                <p>• Automatic vectorization for semantic search integration</p>
                <p>• Batch processing for optimal performance</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Database Statistics</CardTitle>
                <CardDescription>Overview of your video database</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Videos:</span>
                    <span className="font-medium">9,000+</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">User Videos:</span>
                    <span className="font-medium">208</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Competitor Videos:</span>
                    <span className="font-medium">3,580+</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Vectorized Videos:</span>
                    <span className="font-medium">511+</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
                <CardDescription>System performance indicators</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Packaging Analysis:</span>
                    <span className="font-medium">&lt;100ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Semantic Search:</span>
                    <span className="font-medium">300-500ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Dashboard Load:</span>
                    <span className="font-medium">&lt;2s</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>API Configuration</CardTitle>
                <CardDescription>Manage your API keys and settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">YouTube Data API:</span>
                    <Badge variant="outline">Configured</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">YouTube Analytics API:</span>
                    <Badge variant="outline">Configured</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">OpenAI API:</span>
                    <Badge variant="outline">Configured</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Anthropic API:</span>
                    <Badge variant="outline">Configured</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Pinecone API:</span>
                    <Badge variant="outline">Configured</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>System Status</CardTitle>
                <CardDescription>Current system health and status</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Database:</span>
                    <Badge variant="default">Connected</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Vector Search:</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">RSS Monitoring:</span>
                    <Badge variant="default">Ready</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Analytics:</span>
                    <Badge variant="default">Operational</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}