/**
 * Pattern Discovery Tools Tab
 * UI tools for testing and managing the pattern discovery system
 */

"use client"

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Play, Database, Search, Brain, Clock, CheckCircle } from 'lucide-react';

interface TestResult {
  name: string;
  status: 'running' | 'success' | 'error' | 'idle';
  duration?: string;
  message?: string;
  details?: any;
}

export function PatternDiscoveryTab() {
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const updateTestResult = (name: string, updates: Partial<TestResult>) => {
    setTestResults(prev => {
      const existing = prev.find(r => r.name === name);
      if (existing) {
        return prev.map(r => r.name === name ? { ...r, ...updates } : r);
      } else {
        return [...prev, { name, status: 'idle', ...updates }];
      }
    });
  };

  const runQuickTest = async () => {
    setIsRunning(true);
    updateTestResult('Quick Pattern Test', { status: 'running', message: 'Testing with small cluster...' });

    try {
      const response = await fetch('/api/youtube/patterns/quick-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const result = await response.json();

      if (response.ok) {
        updateTestResult('Quick Pattern Test', {
          status: 'success',
          duration: result.duration,
          message: `Found ${result.patternsFound} patterns`,
          details: result
        });
      } else {
        updateTestResult('Quick Pattern Test', {
          status: 'error',
          message: result.error || 'Test failed'
        });
      }
    } catch (error) {
      updateTestResult('Quick Pattern Test', {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsRunning(false);
    }
  };

  const runPatternDiscovery = async () => {
    setIsRunning(true);
    updateTestResult('Pattern Discovery', { status: 'running', message: 'Discovering patterns...' });

    try {
      const response = await fetch('/api/youtube/patterns/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_cluster: 127, // Use a known cluster
          min_performance: 1.5,
          min_confidence: 0.7,
          min_videos: 5,
          limit: 10
        })
      });

      const result = await response.json();

      if (response.ok) {
        updateTestResult('Pattern Discovery', {
          status: 'success',
          duration: `${result.processingTime}s`,
          message: `Discovered ${result.patterns?.length || 0} patterns`,
          details: result
        });
      } else {
        updateTestResult('Pattern Discovery', {
          status: 'error',
          message: result.error || 'Discovery failed'
        });
      }
    } catch (error) {
      updateTestResult('Pattern Discovery', {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsRunning(false);
    }
  };

  const testPatternPrediction = async () => {
    setIsRunning(true);
    updateTestResult('Pattern Prediction', { status: 'running', message: 'Testing prediction...' });

    try {
      const response = await fetch('/api/youtube/patterns/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: "How to Build a Startup for Beginners",
          format: "tutorial",
          niche: "business",
          duration: "PT15M30S",
          topic_cluster: 127
        })
      });

      const result = await response.json();

      if (response.ok) {
        updateTestResult('Pattern Prediction', {
          status: 'success',
          duration: `${result.processingTime}s`,
          message: `Predicted ${result.predicted_performance?.toFixed(2)}x performance`,
          details: result
        });
      } else {
        updateTestResult('Pattern Prediction', {
          status: 'error',
          message: result.error || 'Prediction failed'
        });
      }
    } catch (error) {
      updateTestResult('Pattern Prediction', {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsRunning(false);
    }
  };

  const checkPatternDatabase = async () => {
    setIsRunning(true);
    updateTestResult('Database Check', { status: 'running', message: 'Checking pattern database...' });

    try {
      const response = await fetch('/api/youtube/patterns/list?limit=5');
      const result = await response.json();

      if (response.ok) {
        updateTestResult('Database Check', {
          status: 'success',
          message: `Found ${result.total || 0} total patterns, ${result.patterns?.length || 0} retrieved`,
          details: result
        });
      } else {
        updateTestResult('Database Check', {
          status: 'error',
          message: result.error || 'Database check failed'
        });
      }
    } catch (error) {
      updateTestResult('Database Check', {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsRunning(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Clock className="h-4 w-4 animate-spin" />;
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error': return <CheckCircle className="h-4 w-4 text-red-500" />;
      default: return <CheckCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500';
      case 'success': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Pattern Discovery Tools */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Quick Test */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Quick Pattern Test
            </CardTitle>
            <CardDescription>
              Fast test with small cluster (~30 seconds)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={runQuickTest} 
              disabled={isRunning}
              className="w-full"
            >
              {isRunning ? 'Running...' : 'Run Quick Test'}
            </Button>
            <div className="text-sm text-muted-foreground">
              Tests pattern discovery with relaxed thresholds on a small cluster
            </div>
          </CardContent>
        </Card>

        {/* Database Check */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Database Check
            </CardTitle>
            <CardDescription>
              Check existing patterns in database
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={checkPatternDatabase} 
              disabled={isRunning}
              className="w-full"
              variant="outline"
            >
              {isRunning ? 'Checking...' : 'Check Database'}
            </Button>
            <div className="text-sm text-muted-foreground">
              Lists current patterns and database status
            </div>
          </CardContent>
        </Card>

        {/* Pattern Discovery */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Pattern Discovery
            </CardTitle>
            <CardDescription>
              Discover new patterns in topic cluster 127
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={runPatternDiscovery} 
              disabled={isRunning}
              className="w-full"
              variant="outline"
            >
              {isRunning ? 'Discovering...' : 'Discover Patterns'}
            </Button>
            <div className="text-sm text-muted-foreground">
              Runs full pattern discovery on high-performing cluster
            </div>
          </CardContent>
        </Card>

        {/* Pattern Prediction */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Pattern Prediction
            </CardTitle>
            <CardDescription>
              Test performance prediction system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              onClick={testPatternPrediction} 
              disabled={isRunning}
              className="w-full"
              variant="outline"
            >
              {isRunning ? 'Predicting...' : 'Test Prediction'}
            </Button>
            <div className="text-sm text-muted-foreground">
              Predicts performance for sample video title
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Test Results */}
      {testResults.length > 0 && (
        <>
          <Separator />
          <div>
            <h3 className="text-lg font-semibold mb-4">Test Results</h3>
            <div className="space-y-3">
              {testResults.map((result, index) => (
                <Alert key={index}>
                  <div className="flex items-start gap-3">
                    {getStatusIcon(result.status)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{result.name}</span>
                        <Badge 
                          className={`${getStatusColor(result.status)} text-white`}
                        >
                          {result.status}
                        </Badge>
                        {result.duration && (
                          <Badge variant="outline">{result.duration}</Badge>
                        )}
                      </div>
                      {result.message && (
                        <AlertDescription className="mt-1">
                          {result.message}
                        </AlertDescription>
                      )}
                      {result.details && result.status === 'success' && (
                        <details className="mt-2">
                          <summary className="text-sm cursor-pointer text-muted-foreground">
                            View Details
                          </summary>
                          <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                            {JSON.stringify(result.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </Alert>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Worker Status Info */}
      <Card>
        <CardHeader>
          <CardTitle>Background Worker Commands</CardTitle>
          <CardDescription>
            Commands to run pattern discovery worker
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="font-medium mb-2">Quick Test (30 seconds)</h4>
              <code className="block bg-muted p-2 rounded text-sm">
                npm run test:patterns:quick
              </code>
            </div>
            <div>
              <h4 className="font-medium mb-2">Full Worker (1-3 hours)</h4>
              <code className="block bg-muted p-2 rounded text-sm">
                npm run worker:pattern
              </code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}