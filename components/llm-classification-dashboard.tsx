'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BarChart, Brain, Clock, Zap } from 'lucide-react';

interface BatchSummary {
  processed: number;
  totalTokens: number;
  processingTimeMs: number;
  averageConfidence: number;
  tokensPerVideo: number;
}

interface BatchResults {
  formatDistribution: Record<string, number>;
  examples: Array<{
    title: string;
    format: string;
    confidence: number;
    reasoning: string;
  }>;
}

interface OverallStats {
  totalClassified: number;
  formatDistribution: Record<string, number>;
  averageConfidence: number;
}

interface ClassificationResults {
  summary: BatchSummary;
  batchResults: BatchResults;
  overallStats: OverallStats;
}

const formatLabels: Record<string, string> = {
  tutorial: 'Tutorial',
  listicle: 'Listicle',
  explainer: 'Explainer',
  case_study: 'Case Study',
  news_analysis: 'News Analysis',
  personal_story: 'Personal Story',
  product_focus: 'Product Review'
};

const formatColors: Record<string, string> = {
  tutorial: 'bg-blue-500',
  listicle: 'bg-green-500',
  explainer: 'bg-purple-500',
  case_study: 'bg-orange-500',
  news_analysis: 'bg-red-500',
  personal_story: 'bg-pink-500',
  product_focus: 'bg-yellow-500'
};

export function LLMClassificationDashboard() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ClassificationResults | null>(null);
  const [batchSize, setBatchSize] = useState(100);
  const [currentStats, setCurrentStats] = useState<OverallStats | null>(null);

  // Load current stats on mount
  useEffect(() => {
    loadCurrentStats();
  }, []);

  const loadCurrentStats = async () => {
    try {
      const response = await fetch('/api/classification/llm-batch');
      const data = await response.json();
      setCurrentStats(data.stats);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const runBatchClassification = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/classification/llm-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize })
      });
      
      const data = await response.json();
      setResults(data);
      setCurrentStats(data.overallStats);
    } catch (error) {
      console.error('Error running batch:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatNumber = (num: number) => {
    if (num < 1000) return num.toString();
    return `${(num / 1000).toFixed(1)}k`;
  };

  return (
    <div className="space-y-6">
      {/* Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            LLM-Powered Video Classification
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <select 
              value={batchSize} 
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="px-3 py-2 border rounded-md"
              disabled={isProcessing}
            >
              <option value={50}>50 videos</option>
              <option value={100}>100 videos</option>
              <option value={200}>200 videos</option>
              <option value={500}>500 videos</option>
            </select>
            <Button 
              onClick={runBatchClassification}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Classify Videos'}
            </Button>
          </div>
          {isProcessing && (
            <div className="mt-4">
              <Progress value={50} className="animate-pulse" />
              <p className="text-sm text-muted-foreground mt-2">
                Processing videos in batches of 10...
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Current Stats */}
      {currentStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart className="w-5 h-5" />
              Overall Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">Total Classified</p>
                <p className="text-2xl font-bold">{formatNumber(currentStats.totalClassified)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Confidence</p>
                <p className="text-2xl font-bold">{(currentStats.averageConfidence * 100).toFixed(0)}%</p>
              </div>
            </div>
            
            {/* Format Distribution */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium mb-3">Format Distribution</h4>
              {Object.entries(currentStats.formatDistribution)
                .sort((a, b) => b[1] - a[1])
                .map(([format, count]) => {
                  const percentage = (count / currentStats.totalClassified) * 100;
                  return (
                    <div key={format} className="flex items-center gap-3">
                      <span className="text-sm w-28">{formatLabels[format]}</span>
                      <div className="flex-1 bg-secondary rounded-full h-6 relative overflow-hidden">
                        <div 
                          className={`h-full ${formatColors[format]} transition-all duration-500`}
                          style={{ width: `${percentage}%` }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                          {count} ({percentage.toFixed(1)}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Batch Results */}
      {results && (
        <>
          {/* Performance Metrics */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                Batch Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Processed</p>
                  <p className="text-xl font-bold">{results.summary.processed}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Tokens</p>
                  <p className="text-xl font-bold">{formatNumber(results.summary.totalTokens)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Tokens/Video</p>
                  <p className="text-xl font-bold">{results.summary.tokensPerVideo}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Processing Time</p>
                  <p className="text-xl font-bold">{formatTime(results.summary.processingTimeMs)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Confidence</p>
                  <p className="text-xl font-bold">{(results.summary.averageConfidence * 100).toFixed(0)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Example Classifications */}
          <Card>
            <CardHeader>
              <CardTitle>Sample Classifications</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {results.batchResults.examples.map((example, i) => (
                  <div key={i} className="border rounded-lg p-4 space-y-2">
                    <h4 className="font-medium text-sm">{example.title}</h4>
                    <div className="flex items-center gap-4 text-sm">
                      <span className={`px-2 py-1 rounded text-white ${formatColors[example.format]}`}>
                        {formatLabels[example.format]}
                      </span>
                      <span className="text-muted-foreground">
                        Confidence: {(example.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground italic">{example.reasoning}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}