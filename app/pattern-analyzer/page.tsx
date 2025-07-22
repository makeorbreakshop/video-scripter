'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Copy, Check } from 'lucide-react';

export default function PatternAnalyzerPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const analyzeLatest = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/youtube/patterns/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      if (!response.ok) {
        throw new Error('Failed to analyze patterns');
      }
      
      const data = await response.json();
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!analysis?.summary) return;
    
    try {
      await navigator.clipboard.writeText(analysis.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-100 mb-8">Pattern Generation Analyzer</h1>
        
        <Card className="mb-6 bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-gray-100">Analyze Pattern Generation</CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={analyzeLatest}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Analyze Latest Search'
              )}
            </Button>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded text-red-400">
            {error}
          </div>
        )}

        {analysis && (
          <>
            {/* Summary for Copy/Paste */}
            <Card className="mb-6 bg-gray-800 border-gray-700">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-gray-100">Analysis Summary</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyToClipboard}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={analysis.summary}
                  readOnly
                  className="font-mono text-xs bg-gray-900 text-gray-300 min-h-[400px]"
                />
              </CardContent>
            </Card>

            {/* Detailed Analysis */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Thread Expansion */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-gray-100 text-lg">Thread Expansion</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-400">
                      Total Queries: {analysis.threadExpansion.totalQueries} 
                      (Unique: {analysis.threadExpansion.uniqueQueries})
                    </p>
                    <div className="space-y-2">
                      {analysis.threadExpansion.threads.map((thread: any, idx: number) => (
                        <div key={idx} className="bg-gray-900 p-2 rounded">
                          <p className="font-medium text-gray-300">{thread.name}</p>
                          <p className="text-xs text-gray-500">{thread.queries.join(', ')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Search Results */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-gray-100 text-lg">Search Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-400">
                      Videos Found: {analysis.searchResults.totalVideosFound}
                    </p>
                    <p className="text-gray-400">
                      Unique Channels: {analysis.searchResults.uniqueChannels}
                    </p>
                    <div className="mt-3">
                      <p className="font-medium text-gray-300 mb-1">Performance Distribution:</p>
                      <div className="space-y-1 text-xs">
                        {Object.entries(analysis.searchResults.performanceDistribution).map(([range, count]) => (
                          <div key={range} className="flex justify-between text-gray-500">
                            <span>{range}:</span>
                            <span>{count as number}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Clustering */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-gray-100 text-lg">Clustering Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-400">Total Clusters: {analysis.clustering.totalClusters}</p>
                    <div className="space-y-2 mt-2">
                      {analysis.clustering.clusterSummary.slice(0, 5).map((cluster: any) => (
                        <div key={cluster.id} className="bg-gray-900 p-2 rounded text-xs">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-gray-300">
                              Cluster {cluster.id} ({cluster.type})
                            </span>
                            <span className="text-gray-500">
                              {cluster.size} videos, {cluster.avgPerformance}
                            </span>
                          </div>
                          <p className="text-gray-600 truncate mt-1">{cluster.topVideo}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Discovered Patterns */}
              <Card className="bg-gray-800 border-gray-700">
                <CardHeader>
                  <CardTitle className="text-gray-100 text-lg">Discovered Patterns</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <p className="text-gray-400">Total Patterns: {analysis.patterns.totalDiscovered}</p>
                    <div className="space-y-2 mt-2">
                      {analysis.patterns.patterns.slice(0, 5).map((pattern: any, idx: number) => (
                        <div key={idx} className="bg-gray-900 p-2 rounded">
                          <p className="font-medium text-gray-300 text-xs">{pattern.template}</p>
                          <p className="text-xs text-gray-500 mt-1">{pattern.explanation}</p>
                          <p className="text-xs text-green-400">{pattern.performance}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Final Suggestions Analysis */}
            <Card className="mt-6 bg-gray-800 border-gray-700">
              <CardHeader>
                <CardTitle className="text-gray-100">Final Suggestions Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-300">Total Suggestions</p>
                    <p className="text-2xl font-bold text-gray-100">{analysis.suggestions.total}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-300">Pattern Types</p>
                    <div className="text-sm text-gray-400 mt-1">
                      {Object.entries(analysis.suggestions.patternTypes).map(([type, count]) => (
                        <div key={type}>{type}: {count as number}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-300">Unique Templates</p>
                    <p className="text-2xl font-bold text-gray-100">{analysis.suggestions.templates.length}</p>
                  </div>
                </div>

                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-300 mb-2">Top Suggestions by Performance</p>
                  <div className="space-y-1">
                    {analysis.suggestions.byPerformance.slice(0, 5).map((sugg: any, idx: number) => (
                      <div key={idx} className="text-xs bg-gray-900 p-2 rounded">
                        <span className="text-green-400 font-medium">{sugg.performance}</span>
                        <span className="text-gray-400 ml-2">{sugg.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}