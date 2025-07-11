'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, TrendingUp, Brain, Lightbulb } from 'lucide-react';

interface BatchInsights {
  summary: {
    processed: number;
    llmUsed: number;
    llmUsageRate: string;
    lowConfidence: number;
    averageTopicConfidence: number;
    averageFormatConfidence: number;
  };
  learnings: {
    totalCorrections: number;
    correctionRate: string;
    topCorrections: Array<{ pattern: string; count: number }>;
    channelInsights: Array<{ channel: string; dominantFormat: string; videoCount: number }>;
    potentialKeywords: string[];
  };
  examples: Array<{
    title: string;
    keywordThought: string;
    keywordConfidence: number;
    llmDecided: string;
    llmConfidence: number;
    reasoning?: string;
  }>;
}

export function ClassificationInsights() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [insights, setInsights] = useState<BatchInsights | null>(null);
  const [batchSize, setBatchSize] = useState(100);

  const runBatchWithInsights = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/classification/batch-with-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchSize, useLLMThreshold: 0.6 })
      });
      
      const data = await response.json();
      setInsights(data);
    } catch (error) {
      console.error('Error running batch:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Batch Control */}
      <Card>
        <CardHeader>
          <CardTitle>🎯 Batch Classification with Learning Insights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <select 
              value={batchSize} 
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="px-3 py-2 border rounded-md"
            >
              <option value={50}>50 videos</option>
              <option value={100}>100 videos</option>
              <option value={200}>200 videos</option>
              <option value={500}>500 videos</option>
            </select>
            <Button 
              onClick={runBatchWithInsights}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Run Batch & Learn'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {insights && (
        <>
          {/* Summary Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Batch Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Processed</p>
                  <p className="text-2xl font-bold">{insights.summary.processed}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">LLM Usage Rate</p>
                  <p className="text-2xl font-bold">{insights.summary.llmUsageRate}%</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Format Confidence</p>
                  <p className="text-2xl font-bold">
                    {(insights.summary.averageFormatConfidence * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Learning Insights */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                What We Learned
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Correction Patterns */}
              {insights.learnings.topCorrections.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Common Corrections:</h4>
                  <div className="space-y-1">
                    {insights.learnings.topCorrections.map((correction, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{correction.pattern}</span>
                        <span className="font-medium">{correction.count} times</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Channel Insights */}
              {insights.learnings.channelInsights.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Channel Patterns Discovered:</h4>
                  <div className="space-y-1">
                    {insights.learnings.channelInsights.slice(0, 5).map((channel, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-medium">{channel.channel}</span>
                        <span className="text-muted-foreground"> → mostly {channel.dominantFormat}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Keyword Opportunities */}
              {insights.learnings.potentialKeywords.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4" />
                    Potential New Keywords:
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {insights.learnings.potentialKeywords.map((keyword, i) => (
                      <span key={i} className="px-2 py-1 bg-secondary text-sm rounded">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Example Corrections */}
          {insights.examples.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Example Corrections
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {insights.examples.map((example, i) => (
                    <div key={i} className="border-l-2 border-primary pl-4 space-y-1">
                      <p className="font-medium text-sm">{example.title}</p>
                      <p className="text-sm text-muted-foreground">
                        Keywords thought: <span className="text-destructive">{example.keywordThought}</span> ({(example.keywordConfidence * 100).toFixed(0)}%)
                      </p>
                      <p className="text-sm text-muted-foreground">
                        LLM decided: <span className="text-primary">{example.llmDecided}</span> ({(example.llmConfidence * 100).toFixed(0)}%)
                      </p>
                      {example.reasoning && (
                        <p className="text-xs text-muted-foreground italic">{example.reasoning}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}