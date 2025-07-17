'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, Bug, Activity, Database, Brain, Code, Clock, DollarSign, TrendingUp, Search, Target, Zap, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DebugInfo {
  embeddingLength: number;
  searchThreshold: number;
  totalVideosFound: number;
  scoreDistribution: Record<string, number>;
  topVideos: Array<{
    id: string;
    title: string;
    score: number;
    channel: string;
  }>;
  claudePrompt?: string;
  claudePatterns?: any[];
  processingSteps: Array<{
    step: string;
    duration_ms: number;
    details?: any;
  }>;
  costs?: {
    embedding: {
      tokens: number;
      cost: number;
    };
    claude: {
      inputTokens: number;
      outputTokens: number;
      inputCost: number;
      outputCost: number;
      totalCost: number;
    };
    totalCost: number;
  };
}

interface DebugPanelProps {
  debug?: DebugInfo;
  concept?: string;
}

export function DebugPanel({ debug, concept }: DebugPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('expansion');

  if (!debug) return null;

  // Extract data for collapsed view and tabs
  const expandStep = debug.processingSteps.find(s => s.step === 'Query Expansion' || s.step === 'Multi-Threaded Query Expansion');
  const multiEmbedStep = debug.processingSteps.find(s => s.step === 'Multi-Query Embedding');
  const searchStep = debug.processingSteps.find(s => s.step === 'Multi-Query Pinecone Search');
  const videoDetailsStep = debug.processingSteps.find(s => s.step === 'Fetch Video Details');
  const claudeStep = debug.processingSteps.find(s => s.step === 'Claude Pattern Discovery' || s.step === 'Multi-Threaded Claude Pattern Discovery');
  const titleGenStep = debug.processingSteps.find(s => s.step === 'Title Generation');
  const perfDist = claudeStep?.details?.performanceDistribution;
  const perfTotal = perfDist ? (perfDist.superstar || 0) + (perfDist.strong || 0) + (perfDist.above_avg || 0) + (perfDist.normal || 0) : 0;

  // Extract expanded queries from the timeline
  const expandedQueriesRaw = expandStep?.details?.expandedQueries || [];
  const expandedQueries = Array.isArray(expandedQueriesRaw) ? expandedQueriesRaw : [];
  const originalQuery = expandStep?.details?.originalQuery || concept || '';

  // Tab configuration
  const tabs = [
    { id: 'expansion', label: 'Query Expansion', icon: Search, step: 1, description: 'Expand concept into multiple search queries' },
    { id: 'embeddings', label: 'Embeddings', icon: Zap, step: 2, description: 'Convert queries to semantic vectors' },
    { id: 'search', label: 'Search Results', icon: Database, step: 3, description: 'Find similar videos in database' },
    { id: 'performance', label: 'Performance', icon: TrendingUp, step: 4, description: 'Analyze video performance metrics' },
    { id: 'patterns', label: 'Pattern Discovery', icon: Brain, step: 5, description: 'Discover title patterns with AI' },
    { id: 'costs', label: 'Costs & Timeline', icon: DollarSign, step: 6, description: 'View costs and processing time' }
  ];

  const hasData = (tabId: string) => {
    switch (tabId) {
      case 'expansion': return expandStep !== undefined;
      case 'embeddings': return multiEmbedStep !== undefined;
      case 'search': return searchStep !== undefined;
      case 'performance': return perfDist !== undefined;
      case 'patterns': return debug.claudePatterns && debug.claudePatterns.length > 0;
      case 'costs': return debug.costs !== undefined;
      default: return false;
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 border-t border-gray-700 shadow-2xl">
      {/* Collapsed View */}
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-medium text-gray-100">Debug Panel</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Badge variant="outline" className="text-xs">
              {debug.totalVideosFound} videos found
            </Badge>
            {expandStep?.details?.totalQueries && (
              <Badge variant="outline" className="text-xs text-purple-400 border-purple-400/50">
                {expandStep.details.totalQueries} queries
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              Threshold: {debug.searchThreshold}
            </Badge>
            {perfDist?.superstar && (
              <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/50">
                🌟 {perfDist.superstar} superstars
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {debug.processingSteps.reduce((sum, step) => sum + step.duration_ms, 0)}ms total
            </Badge>
            {debug.costs && (
              <Badge variant="outline" className="text-xs text-green-400 border-green-400/50">
                ${debug.costs.totalCost.toFixed(4)}
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-400 hover:text-gray-200"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="h-4 w-4 mr-1" />
              Collapse
            </>
          ) : (
            <>
              <ChevronUp className="h-4 w-4 mr-1" />
              Expand
            </>
          )}
        </Button>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div className="max-h-[60vh] overflow-y-auto border-t border-gray-800">
          <div className="p-4">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-6 bg-gray-800 border-gray-700">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <TabsTrigger 
                      key={tab.id} 
                      value={tab.id}
                      className="flex items-center gap-1 text-xs data-[state=active]:bg-gray-700 data-[state=active]:text-gray-100"
                      title={`Step ${tab.step}: ${tab.description}`}
                    >
                      <Icon className="h-3 w-3" />
                      <span className="hidden sm:inline">Step {tab.step}</span>
                      <span className="sm:hidden">{tab.step}</span>
                      {hasData(tab.id) && (
                        <div className="w-2 h-2 bg-green-500 rounded-full ml-1" />
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {/* Tab 1: Query Expansion */}
              <TabsContent value="expansion" className="mt-4">
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Search className="h-4 w-4" />
                      <div>
                        <div>Query Expansion (Step 1)</div>
                        <div className="text-xs font-normal text-gray-400 mt-0.5">Expand your concept into related search queries</div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {expandStep ? (
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-medium text-gray-400 mb-2">Original Query:</h4>
                          <p className="text-sm text-gray-200 font-mono bg-gray-700 p-2 rounded">
                            {originalQuery}
                          </p>
                        </div>
                        
                        {/* Check if we have multi-threaded expansion data */}
                        {expandStep.details?.threads ? (
                          <div>
                            <h4 className="text-xs font-medium text-gray-400 mb-2">
                              Multi-Threaded Expansion ({expandStep.details?.totalQueries || 0} queries across {expandStep.details?.threads?.length || 0} threads):
                            </h4>
                            <div className="space-y-4">
                              {expandStep.details.threads.map((thread: any, i: number) => (
                                <div key={i} className="border border-gray-700 rounded-lg p-3">
                                  <div className="flex items-start justify-between mb-2">
                                    <div>
                                      <h5 className="text-sm font-medium text-gray-200">{thread.name}</h5>
                                      <p className="text-xs text-gray-400 mt-1">{thread.purpose}</p>
                                    </div>
                                    <span className="text-xs text-blue-400">{thread.queryCount} queries</span>
                                  </div>
                                  <div className="space-y-1 mt-2">
                                    {thread.queries.map((query: string, j: number) => (
                                      <div key={j} className="text-xs text-gray-300 font-mono bg-gray-700/30 p-1.5 rounded">
                                        {query}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <h4 className="text-xs font-medium text-gray-400 mb-2">
                              Expanded Queries ({expandStep.details?.totalQueries || 0} total):
                            </h4>
                            <div className="space-y-1">
                              {expandedQueries.map((query: string, i: number) => (
                                <div key={i} className="text-sm text-gray-300 font-mono bg-gray-700/50 p-2 rounded flex items-center">
                                  <span className="text-blue-400 mr-2">{i + 1}.</span>
                                  {query}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">Processing Time:</span>
                            <span className="ml-2 text-gray-100">{expandStep.duration_ms}ms</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Model:</span>
                            <span className="ml-2 text-gray-100">GPT-4o-mini</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No query expansion data available</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 2: Embeddings */}
              <TabsContent value="embeddings" className="mt-4">
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      <div>
                        <div>Embeddings (Step 2)</div>
                        <div className="text-xs font-normal text-gray-400 mt-0.5">Convert search queries into semantic vectors</div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {multiEmbedStep ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">Queries Embedded:</span>
                            <span className="ml-2 text-gray-100 font-medium">{multiEmbedStep.details?.queriesEmbedded || 0}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Model:</span>
                            <span className="ml-2 text-gray-100">{multiEmbedStep.details?.embeddingModel}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Total Tokens:</span>
                            <span className="ml-2 text-gray-100">{multiEmbedStep.details?.totalTokens?.toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Cost:</span>
                            <span className="ml-2 text-green-400">${multiEmbedStep.details?.totalCost?.toFixed(6)}</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Processing Time:</span>
                            <span className="ml-2 text-gray-100">{multiEmbedStep.duration_ms}ms</span>
                          </div>
                          <div>
                            <span className="text-gray-400">Dimensions:</span>
                            <span className="ml-2 text-gray-100">{debug.embeddingLength}</span>
                          </div>
                        </div>
                        
                        <div className="text-xs text-gray-500 bg-gray-700/50 p-2 rounded">
                          💡 Each query is converted to a {debug.embeddingLength}-dimensional vector for similarity search
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No embedding data available</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 3: Search Results */}
              <TabsContent value="search" className="mt-4">
                <div className="space-y-4">
                  <Card className="bg-gray-800 border-gray-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        <div>
                          <div>Pinecone Search (Step 3)</div>
                          <div className="text-xs font-normal text-gray-400 mt-0.5">Find semantically similar videos in our database</div>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {searchStep ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-gray-400">Search Threshold:</span>
                              <span className="ml-2 text-gray-100 font-medium">{searchStep.details?.threshold}</span>
                            </div>
                            <div>
                              <span className="text-gray-400">Videos Per Query:</span>
                              <span className="ml-2 text-gray-100 font-medium">{searchStep.details?.videosPerQuery}</span>
                            </div>
                            <div>
                              <span className="text-gray-400">Total Results:</span>
                              <span className="ml-2 text-gray-100 font-medium">{searchStep.details?.totalResultsBeforeDedupe?.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-gray-400">Unique Videos:</span>
                              <span className="ml-2 text-gray-100 font-medium">{searchStep.details?.uniqueVideosFound?.toLocaleString()}</span>
                            </div>
                          </div>
                          
                          <div>
                            <h4 className="text-xs font-medium text-gray-400 mb-2">Processing Time:</h4>
                            <p className="text-sm text-gray-100">{searchStep.duration_ms}ms</p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-500 text-sm">No search data available</p>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* Score Distribution */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="bg-gray-800 border-gray-700">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Score Distribution
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          {Object.entries(debug.scoreDistribution)
                            .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
                            .map(([score, count]) => (
                              <div key={score} className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">{score} similarity</span>
                                <div className="flex items-center gap-2">
                                  <div className="w-20 bg-gray-700 rounded-full h-2">
                                    <div
                                      className="bg-blue-500 h-2 rounded-full"
                                      style={{
                                        width: `${(count / debug.totalVideosFound) * 100}%`
                                      }}
                                    />
                                  </div>
                                  <span className="text-gray-300 text-xs w-8 text-right">{count}</span>
                                </div>
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                    
                    {/* All Found Videos */}
                    <Card className="bg-gray-800 border-gray-700">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Target className="h-4 w-4" />
                          All Found Videos ({debug.allVideosWithDetails?.length || debug.topVideos.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="max-h-96 overflow-y-auto space-y-2">
                          {(debug.allVideosWithDetails || debug.topVideos).map((video, i) => {
                            const title = video.title || 'Unknown';
                            const channel = video.channelName || video.channel || 'Unknown';
                            const score = video.similarityScore || video.score || 0;
                            const performance = video.performanceRatio || 0;
                            
                            return (
                              <div key={i} className="text-xs space-y-1 p-2 bg-gray-700/50 rounded">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-300 truncate flex-1 mr-2" title={title}>
                                    {title}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <Badge variant="outline" className="text-xs">
                                      {(score * 100).toFixed(1)}%
                                    </Badge>
                                    {performance > 0 && (
                                      <Badge variant="outline" className={`text-xs ${
                                        performance >= 10 ? 'border-purple-400 text-purple-400' :
                                        performance >= 3 ? 'border-green-400 text-green-400' :
                                        performance >= 1.5 ? 'border-blue-400 text-blue-400' :
                                        'border-gray-400 text-gray-400'
                                      }`}>
                                        {performance.toFixed(1)}x
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="text-gray-500 pl-2">
                                  {channel}
                                  {video.viewCount && (
                                    <span className="ml-2">• {video.viewCount.toLocaleString()} views</span>
                                  )}
                                </div>
                                {video.foundVia && (
                                  <div className="text-xs text-blue-400 pl-2 mt-1">
                                    via {video.foundVia.thread} - {video.foundVia.query}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 4: Performance Analysis */}
              <TabsContent value="performance" className="mt-4">
                <Card className="bg-gray-800 border-gray-700">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      <div>
                        <div>Performance Analysis (Step 4)</div>
                        <div className="text-xs font-normal text-gray-400 mt-0.5">Categorize videos by their performance multiplier</div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {perfDist && typeof perfDist === 'object' ? (
                      <div className="space-y-4">
                        <div className="text-sm text-gray-400 mb-3">
                          Performance tiers based on channel average multipliers ({perfTotal} total videos)
                        </div>
                        
                        <div className="space-y-3">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-300">🌟 Superstar (10x+)</span>
                              <span className="text-sm font-medium text-gray-100">{perfDist.superstar || 0}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-gradient-to-r from-purple-500 to-purple-600 h-2 rounded-full"
                                style={{ width: `${perfTotal > 0 ? ((perfDist.superstar || 0) / perfTotal) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-300">💪 Strong (3-10x)</span>
                              <span className="text-sm font-medium text-gray-100">{perfDist.strong || 0}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full"
                                style={{ width: `${perfTotal > 0 ? ((perfDist.strong || 0) / perfTotal) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-300">✅ Above Avg (1.5-3x)</span>
                              <span className="text-sm font-medium text-gray-100">{perfDist.above_avg || 0}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full"
                                style={{ width: `${perfTotal > 0 ? ((perfDist.above_avg || 0) / perfTotal) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-300">📊 Normal (&lt;1.5x)</span>
                              <span className="text-sm font-medium text-gray-100">{perfDist.normal || 0}</span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-2">
                              <div 
                                className="bg-gray-500 h-2 rounded-full"
                                style={{ width: `${perfTotal > 0 ? ((perfDist.normal || 0) / perfTotal) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-xs text-gray-500 bg-gray-700/50 p-2 rounded">
                          💡 Videos are stratified by performance: 15 superstar + 20 strong + 15 above avg selected for Claude analysis
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No performance data available</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 5: Pattern Discovery */}
              <TabsContent value="patterns" className="mt-4">
                <div className="space-y-4">
                  {/* Claude Analysis - Multi-threaded or Single */}
                  {(debug.claudePrompts || debug.claudePrompt) && (
                    <Card className="bg-gray-800 border-gray-700">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Brain className="h-4 w-4" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span>Pattern Discovery (Step 5)</span>
                              {claudeStep?.details?.threadsAnalyzed && (
                                <Badge variant="outline" className="text-xs">
                                  {claudeStep.details.threadsAnalyzed} threads
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs font-normal text-gray-400 mt-0.5">AI discovers patterns from high-performing videos</div>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {/* Multi-threaded analysis */}
                          {debug.claudePrompts && Object.keys(debug.claudePrompts).length > 0 ? (
                            <>
                              <div className="text-sm text-gray-400 mb-3">
                                Multi-threaded pattern analysis across {Object.keys(debug.claudePrompts).length} threads
                              </div>
                              {claudeStep?.details?.threadBreakdown && (
                                <div className="space-y-2 mb-3">
                                  {claudeStep.details.threadBreakdown.map((thread: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between text-xs bg-gray-700/50 p-2 rounded">
                                      <span className="text-gray-300">{thread.thread}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-400">{thread.videosAnalyzed} videos</span>
                                        <Badge variant="outline" className="text-xs">
                                          {thread.patternsFound} patterns
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {Object.entries(debug.claudePrompts).map(([thread, prompt]) => (
                                <details key={thread} className="group">
                                  <summary className="cursor-pointer text-sm text-gray-300 hover:text-gray-100">
                                    View {thread} Prompt
                                  </summary>
                                  <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-x-auto mt-2 bg-gray-700/50 p-3 rounded max-h-48 overflow-y-auto">
                                    {prompt}
                                  </pre>
                                </details>
                              ))}
                            </>
                          ) : (
                            <>
                              <div className="text-sm text-gray-400">
                                OpenAI analyzes {claudeStep?.details?.videosAnalyzedByClaude || 0} high-performing videos to discover patterns
                              </div>
                              <details className="group">
                                <summary className="cursor-pointer text-sm text-gray-300 hover:text-gray-100">
                                  View Full Prompt
                                </summary>
                                <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-x-auto mt-2 bg-gray-700/50 p-3 rounded max-h-48 overflow-y-auto">
                                  {debug.claudePrompt}
                                </pre>
                              </details>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Discovered Patterns */}
                  {debug.claudePatterns && debug.claudePatterns.length > 0 && (
                    <Card className="bg-gray-800 border-gray-700">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Code className="h-4 w-4" />
                          <div>
                            <div>Discovered Patterns ({debug.claudePatterns.length})</div>
                            <div className="text-xs font-normal text-gray-400 mt-0.5">Title templates extracted from successful videos</div>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {debug.claudePatterns.map((pattern: any, i: number) => (
                            <div key={i} className="border border-gray-700 rounded p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <h4 className="font-medium text-gray-200">{pattern.pattern}</h4>
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs">
                                    {pattern.performance_multiplier}x
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    {(pattern.confidence * 100).toFixed(0)}%
                                  </Badge>
                                  {pattern.source_thread && (
                                    <Badge variant="outline" className="text-xs bg-blue-900/30 text-blue-300">
                                      {pattern.source_thread}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <p className="text-xs text-gray-400">{pattern.explanation}</p>
                              {pattern.thread_purpose && (
                                <p className="text-xs text-blue-400">Source: {pattern.thread_purpose}</p>
                              )}
                              <div className="text-xs text-gray-300 font-mono bg-gray-700/50 p-2 rounded">
                                Template: {pattern.template}
                              </div>
                              <div className="text-xs text-gray-500">
                                Examples: {pattern.examples.join(' • ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {/* Tab 6: Costs & Timeline */}
              <TabsContent value="costs" className="mt-4">
                <div className="space-y-4">
                  {/* Timeline */}
                  <Card className="bg-gray-800 border-gray-700">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <div>
                          <div>Processing Timeline</div>
                          <div className="text-xs font-normal text-gray-400 mt-0.5">Time taken for each step in the pipeline</div>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {debug.processingSteps.map((step, i) => (
                          <div key={i} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-blue-500 rounded-full" />
                              <span className="text-gray-300">{step.step}</span>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {step.duration_ms}ms
                            </Badge>
                          </div>
                        ))}
                        <Separator className="bg-gray-700 my-2" />
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span className="text-gray-200">Total Time</span>
                          <span className="text-gray-100">
                            {debug.processingSteps.reduce((sum, step) => sum + step.duration_ms, 0)}ms
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  {/* Cost Breakdown */}
                  {debug.costs && (
                    <Card className="bg-gray-800 border-gray-700">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <DollarSign className="h-4 w-4" />
                          <div>
                            <div>Cost Breakdown</div>
                            <div className="text-xs font-normal text-gray-400 mt-0.5">API costs for generating title suggestions</div>
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {/* OpenAI Embedding */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-300">OpenAI Embedding</span>
                              <span className="text-green-400">${debug.costs.embedding.cost.toFixed(6)}</span>
                            </div>
                            <div className="text-xs text-gray-500">
                              {debug.costs.embedding.tokens.toLocaleString()} tokens × $0.02/1M
                            </div>
                          </div>
                          
                          <Separator className="bg-gray-700" />
                          
                          {/* OpenAI Costs */}
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-300">OpenAI GPT-4o-mini</span>
                              <span className="text-green-400">${debug.costs.claude.totalCost.toFixed(4)}</span>
                            </div>
                            <div className="space-y-1 text-xs text-gray-500 ml-2">
                              <div className="flex justify-between">
                                <span>Input: {debug.costs.claude.inputTokens.toLocaleString()} tokens</span>
                                <span>${debug.costs.claude.inputCost.toFixed(4)}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Output: {debug.costs.claude.outputTokens.toLocaleString()} tokens</span>
                                <span>${debug.costs.claude.outputCost.toFixed(4)}</span>
                              </div>
                            </div>
                          </div>
                          
                          <Separator className="bg-gray-700" />
                          
                          {/* Total */}
                          <div className="flex items-center justify-between text-sm font-medium">
                            <span className="text-gray-200">Total Cost</span>
                            <span className="text-green-400">${debug.costs.totalCost.toFixed(4)}</span>
                          </div>
                          
                          {/* Pricing Info */}
                          <div className="text-xs text-gray-500 pt-2 space-y-1">
                            <div>OpenAI Embedding: $0.02 / 1M tokens</div>
                            <div>GPT-4o-mini Input: $0.15 / 1M tokens</div>
                            <div>GPT-4o-mini Output: $0.60 / 1M tokens</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      )}
    </div>
  );
}