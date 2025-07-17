'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, Bug, Activity, Database, Brain, Code, Clock, DollarSign } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

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
  const [showPrompt, setShowPrompt] = useState(false);
  const [showPatterns, setShowPatterns] = useState(false);

  if (!debug) return null;

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
            <Badge variant="outline" className="text-xs">
              Threshold: {debug.searchThreshold}
            </Badge>
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
          <div className="p-4 space-y-4">
            {/* Processing Timeline */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Processing Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {debug.processingSteps.map((step, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <Activity className="h-3 w-3 text-blue-400" />
                      <span className="text-gray-300">{step.step}</span>
                      {step.details && (
                        <span className="text-xs text-gray-500">
                          {Object.entries(step.details)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(', ')}
                        </span>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {step.duration_ms}ms
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Search Results */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Score Distribution */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Database className="h-4 w-4" />
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

              {/* Top Matching Videos */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Top Matching Videos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {debug.topVideos.slice(0, 5).map((video, i) => (
                      <div key={i} className="text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-300 truncate flex-1 mr-2" title={video.title}>
                            {video.title}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {(video.score * 100).toFixed(1)}%
                          </Badge>
                        </div>
                        <div className="text-gray-500 pl-2">
                          {video.channel}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Claude Prompt */}
            {debug.claudePrompt && (
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      Claude Prompt
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPrompt(!showPrompt)}
                      className="text-xs"
                    >
                      {showPrompt ? 'Hide' : 'Show'}
                    </Button>
                  </CardTitle>
                </CardHeader>
                {showPrompt && (
                  <CardContent>
                    <pre className="text-xs text-gray-400 whitespace-pre-wrap overflow-x-auto">
                      {debug.claudePrompt}
                    </pre>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Discovered Patterns */}
            {debug.claudePatterns && debug.claudePatterns.length > 0 && (
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Code className="h-4 w-4" />
                      Discovered Patterns ({debug.claudePatterns.length})
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPatterns(!showPatterns)}
                      className="text-xs"
                    >
                      {showPatterns ? 'Hide' : 'Show'}
                    </Button>
                  </CardTitle>
                </CardHeader>
                {showPatterns && (
                  <CardContent>
                    <div className="space-y-2">
                      {debug.claudePatterns.map((pattern, i) => (
                        <div key={i} className="p-2 bg-gray-700 rounded text-xs space-y-1">
                          <div className="font-medium text-gray-200">{pattern.pattern}</div>
                          <div className="text-gray-400">Template: {pattern.template}</div>
                          <div className="text-gray-500">
                            Performance: {pattern.performance_multiplier}x | 
                            Confidence: {(pattern.confidence * 100).toFixed(0)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Cost Breakdown */}
            {debug.costs && (
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Cost Breakdown
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
                        {debug.costs.embedding.tokens} tokens × $0.02/1M
                      </div>
                    </div>
                    
                    <Separator className="bg-gray-700" />
                    
                    {/* Claude Costs */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-300">Claude 3.5 Sonnet</span>
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
                    <div className="text-xs text-gray-500 pt-2">
                      <div>OpenAI: $0.02 / 1M tokens</div>
                      <div>Claude Input: $3.00 / 1M tokens</div>
                      <div>Claude Output: $15.00 / 1M tokens</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Technical Details */}
            <Card className="bg-gray-800 border-gray-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Technical Details</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-gray-400">Embedding Model:</dt>
                  <dd className="text-gray-300">text-embedding-3-small</dd>
                  <dt className="text-gray-400">Embedding Dimensions:</dt>
                  <dd className="text-gray-300">{debug.embeddingLength}</dd>
                  <dt className="text-gray-400">Search Threshold:</dt>
                  <dd className="text-gray-300">{debug.searchThreshold}</dd>
                  <dt className="text-gray-400">Total Videos Found:</dt>
                  <dd className="text-gray-300">{debug.totalVideosFound}</dd>
                  <dt className="text-gray-400">Concept:</dt>
                  <dd className="text-gray-300">{concept || 'N/A'}</dd>
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}