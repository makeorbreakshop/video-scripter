'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LLMClassificationDashboard } from '@/components/llm-classification-dashboard';

export default function TestLLMClassificationPage() {
  const [testResults, setTestResults] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const runTest = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/test-llm-classification');
      const data = await response.json();
      setTestResults(data);
    } catch (error) {
      console.error('Test failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">LLM Classification System Test</h1>
      
      {/* Test Section */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Test the LLM classification with sample videos before running on real data.
          </p>
          <Button onClick={runTest} disabled={isLoading}>
            {isLoading ? 'Running Test...' : 'Run Sample Classification'}
          </Button>
          
          {testResults && (
            <div className="mt-4 space-y-3">
              <div className="bg-secondary p-3 rounded-lg">
                <h4 className="font-medium mb-2">Test Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Videos: {testResults.summary.videosProcessed}</div>
                  <div>Tokens: {testResults.summary.totalTokens}</div>
                  <div>Time: {testResults.summary.processingTimeMs}ms</div>
                  <div>Tokens/Video: {testResults.summary.avgTokensPerVideo}</div>
                </div>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium">Results:</h4>
                {testResults.results.map((result: any, i: number) => (
                  <div key={i} className="border rounded p-3 text-sm space-y-1">
                    <div className="font-medium">{result.title}</div>
                    <div className="flex gap-2">
                      <span className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs">
                        {result.format}
                      </span>
                      <span className="text-muted-foreground">{result.confidence}</span>
                    </div>
                    <div className="text-xs text-muted-foreground italic">{result.reasoning}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Main Dashboard */}
      <LLMClassificationDashboard />
    </div>
  );
}