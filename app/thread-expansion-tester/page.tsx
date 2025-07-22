'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Copy, Check } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PROMPTS } from './prompts';
import { evaluateThreadExpansion, type OverallEvaluation } from './evaluation-utils';

// Model pricing per 1M tokens
const MODEL_PRICING = {
  // OpenAI
  'gpt-4o': { input: 2.50, output: 10.00, name: 'GPT-4o' },
  'gpt-4o-mini': { input: 0.15, output: 0.60, name: 'GPT-4o Mini' },
  'gpt-4-turbo': { input: 10.00, output: 30.00, name: 'GPT-4 Turbo' },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50, name: 'GPT-3.5 Turbo' },
  
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, name: 'Claude 3.5 Sonnet' },
  'claude-3-5-haiku-20241022': { input: 1.00, output: 5.00, name: 'Claude 3.5 Haiku' },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00, name: 'Claude 3 Opus' },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00, name: 'Claude 3 Sonnet' },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, name: 'Claude 3 Haiku' },
} as const;

type ModelId = keyof typeof MODEL_PRICING;

// Default prompt removed - using prompts from prompts.ts file

interface TestResult {
  model: string;
  threads: any[];
  queryCount: number;
  prohibitedTerms: number;
  cost: {
    input: number;
    output: number;
    total: number;
  };
  tokensUsed: {
    input: number;
    output: number;
  };
  timeMs: number;
  evaluation?: OverallEvaluation;
  error?: string;
}

export default function ThreadExpansionTester() {
  const [concept, setConcept] = useState('xTool F2 fiber laser review');
  const [prompt, setPrompt] = useState(PROMPTS.progressiveTopicExpansion);
  const [selectedModel, setSelectedModel] = useState<ModelId>('claude-3-5-sonnet-20241022');
  const [selectedPromptStrategy, setSelectedPromptStrategy] = useState<keyof typeof PROMPTS>('progressiveTopicExpansion');
  const [temperature, setTemperature] = useState(0.7);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TestResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchResults, setBatchResults] = useState<TestResult[]>([]);
  const [batchProgress, setBatchProgress] = useState(0);

  const runTest = async () => {
    setIsLoading(true);
    setResults(null);
    
    const startTime = Date.now();
    
    try {
      const response = await fetch('/api/test-thread-expansion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concept,
          prompt: prompt.replace('{concept}', concept),
          model: selectedModel,
          temperature
        })
      });

      const data = await response.json();
      
      if (data.error) {
        setResults({
          model: selectedModel,
          threads: [],
          queryCount: 0,
          prohibitedTerms: 0,
          cost: { input: 0, output: 0, total: 0 },
          tokensUsed: { input: 0, output: 0 },
          timeMs: Date.now() - startTime,
          error: data.error
        });
      } else {
        // Analyze results
        const allQueries = data.threads.flatMap((t: any) => t.queries || []);
        const prohibitedTerms = allQueries.filter((q: string) => 
          q.toLowerCase().includes('laser') || 
          q.toLowerCase().includes('xtool') ||
          q.toLowerCase().includes('fiber') ||
          q.toLowerCase().includes(concept.split(' ')[0].toLowerCase())
        ).length;
        
        // Evaluate thread expansion quality
        const evaluation = evaluateThreadExpansion(concept, data.threads);
        
        // Calculate cost
        const pricing = MODEL_PRICING[selectedModel];
        const inputCost = (data.tokensUsed.input / 1_000_000) * pricing.input;
        const outputCost = (data.tokensUsed.output / 1_000_000) * pricing.output;
        
        setResults({
          model: MODEL_PRICING[selectedModel].name,
          threads: data.threads,
          queryCount: allQueries.length,
          prohibitedTerms,
          cost: {
            input: inputCost,
            output: outputCost,
            total: inputCost + outputCost
          },
          tokensUsed: data.tokensUsed,
          timeMs: Date.now() - startTime,
          evaluation
        });
      }
    } catch (error) {
      setResults({
        model: selectedModel,
        threads: [],
        queryCount: 0,
        prohibitedTerms: 0,
        cost: { input: 0, output: 0, total: 0 },
        tokensUsed: { input: 0, output: 0 },
        timeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runBatchTests = async () => {
    setIsLoading(true);
    setBatchResults([]);
    setBatchProgress(0);
    setBatchMode(true);
    
    const strategies = Object.keys(PROMPTS) as (keyof typeof PROMPTS)[];
    const results: TestResult[] = [];
    
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];
      const strategyPrompt = PROMPTS[strategy];
      setBatchProgress((i / strategies.length) * 100);
      
      const startTime = Date.now();
      
      try {
        const response = await fetch('/api/test-thread-expansion', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            concept,
            prompt: strategyPrompt.replace('{concept}', concept),
            model: selectedModel,
            temperature
          })
        });

        const data = await response.json();
        
        if (data.error) {
          results.push({
            model: selectedModel,
            threads: [],
            queryCount: 0,
            prohibitedTerms: 0,
            cost: { input: 0, output: 0, total: 0 },
            tokensUsed: { input: 0, output: 0 },
            timeMs: Date.now() - startTime,
            error: data.error
          });
        } else {
          // Analyze results
          const allQueries = data.threads.flatMap((t: any) => t.queries || []);
          const prohibitedTerms = allQueries.filter((q: string) => 
            q.toLowerCase().includes('laser') || 
            q.toLowerCase().includes('xtool') ||
            q.toLowerCase().includes('fiber') ||
            q.toLowerCase().includes(concept.split(' ')[0].toLowerCase())
          ).length;
          
          // Evaluate thread expansion quality
          const evaluation = evaluateThreadExpansion(concept, data.threads);
          
          // Calculate cost
          const pricing = MODEL_PRICING[selectedModel];
          const inputCost = (data.tokensUsed.input / 1_000_000) * pricing.input;
          const outputCost = (data.tokensUsed.output / 1_000_000) * pricing.output;
          
          results.push({
            model: MODEL_PRICING[selectedModel].name,
            threads: data.threads,
            queryCount: allQueries.length,
            prohibitedTerms,
            cost: {
              input: inputCost,
              output: outputCost,
              total: inputCost + outputCost
            },
            tokensUsed: data.tokensUsed,
            timeMs: Date.now() - startTime,
            evaluation
          });
        }
      } catch (error) {
        results.push({
          model: selectedModel,
          threads: [],
          queryCount: 0,
          prohibitedTerms: 0,
          cost: { input: 0, output: 0, total: 0 },
          tokensUsed: { input: 0, output: 0 },
          timeMs: Date.now() - startTime,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      
      setBatchResults([...results]);
      
      // Wait a bit between requests to avoid rate limiting
      if (i < strategies.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    setBatchProgress(100);
    setIsLoading(false);
  };

  const copyResults = () => {
    if (results && !results.error) {
      const text = JSON.stringify(results.threads, null, 2);
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const copyBatchResults = () => {
    const strategies = Object.keys(PROMPTS) as (keyof typeof PROMPTS)[];
    const summary = {
      concept,
      model: selectedModel,
      temperature,
      timestamp: new Date().toISOString(),
      results: batchResults.map((result, i) => ({
        strategy: strategies[i],
        overallScore: result.evaluation?.overallScore || 0,
        sweetSpotPercentage: result.evaluation ? 
          (result.evaluation.topicDistance.level3_sweetSpot / result.queryCount * 100) : 0,
        categoryCount: result.evaluation?.categoryCount || 0,
        semanticDiversity: result.evaluation?.semanticDiversity || 0,
        estimatedVideoPool: result.evaluation?.estimatedVideoPool || 0,
        cost: result.cost.total,
        timeMs: result.timeMs,
        error: result.error,
        // Include sample queries for analysis
        sampleQueries: result.threads.slice(0, 2).map(t => ({
          angle: t.angle || t.threadName,
          queries: t.queries
        })),
        topicDistribution: result.evaluation?.topicDistance
      }))
    };
    
    navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container mx-auto py-8 max-w-6xl">
      <h1 className="text-3xl font-bold mb-8">Thread Expansion Model Tester</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
              <CardDescription>Test different models and prompts for thread expansion</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Concept</label>
                <input
                  type="text"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  placeholder="Enter concept to expand..."
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Model</label>
                <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as ModelId)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o">GPT-4o ($2.50/$10.00)</SelectItem>
                    <SelectItem value="gpt-4o-mini">GPT-4o Mini ($0.15/$0.60)</SelectItem>
                    <SelectItem value="gpt-4-turbo">GPT-4 Turbo ($10.00/$30.00)</SelectItem>
                    <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo ($0.50/$1.50)</SelectItem>
                    <SelectItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet ($3.00/$15.00)</SelectItem>
                    <SelectItem value="claude-3-5-haiku-20241022">Claude 3.5 Haiku ($1.00/$5.00)</SelectItem>
                    <SelectItem value="claude-3-opus-20240229">Claude 3 Opus ($15.00/$75.00)</SelectItem>
                    <SelectItem value="claude-3-sonnet-20240229">Claude 3 Sonnet ($3.00/$15.00)</SelectItem>
                    <SelectItem value="claude-3-haiku-20240307">Claude 3 Haiku ($0.25/$1.25)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Temperature: {temperature}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Prompt Strategy</label>
                <Select 
                  value={selectedPromptStrategy} 
                  onValueChange={(v) => {
                    setSelectedPromptStrategy(v as keyof typeof PROMPTS);
                    setPrompt(PROMPTS[v as keyof typeof PROMPTS]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="progressiveTopicExpansion">Progressive Topic Expansion</SelectItem>
                    <SelectItem value="categoricalHierarchyExpansion">Categorical Hierarchy Expansion</SelectItem>
                    <SelectItem value="purposeBasedExpansion">Purpose-Based Expansion</SelectItem>
                    <SelectItem value="audienceInterestExpansion">Audience-Interest Expansion</SelectItem>
                    <SelectItem value="industryVerticalExpansion">Industry-Vertical Expansion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Prompt Template</label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                />
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={runTest} 
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading && !batchMode ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    'Run Single Test'
                  )}
                </Button>
                
                <Button 
                  onClick={runBatchTests} 
                  disabled={isLoading}
                  variant="outline"
                  className="flex-1"
                >
                  {isLoading && batchMode ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {Math.round(batchProgress)}%
                    </>
                  ) : (
                    'Test All Strategies'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Results Panel */}
        <div className="space-y-6">
          {/* Batch Results */}
          {batchResults.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Batch Test Results</CardTitle>
                <CardDescription>
                  Comparison of all strategies for: {concept}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Summary Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Strategy</th>
                          <th className="text-center p-2">Score</th>
                          <th className="text-center p-2">Sweet Spot</th>
                          <th className="text-center p-2">Categories</th>
                          <th className="text-center p-2">Diversity</th>
                          <th className="text-center p-2">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Object.keys(PROMPTS) as (keyof typeof PROMPTS)[]).map((strategy, i) => {
                          const result = batchResults[i];
                          if (!result) return null;
                          
                          const sweetSpot = result.evaluation ? 
                            (result.evaluation.topicDistance.level3_sweetSpot / result.queryCount * 100) : 0;
                          
                          return (
                            <tr key={strategy} className="border-b">
                              <td className="p-2">{strategy}</td>
                              <td className="text-center p-2 font-bold">
                                {result.error ? '❌' : `${result.evaluation?.overallScore || 0}`}
                              </td>
                              <td className="text-center p-2">
                                {result.error ? '-' : `${sweetSpot.toFixed(0)}%`}
                              </td>
                              <td className="text-center p-2">
                                {result.error ? '-' : result.evaluation?.categoryCount || 0}
                              </td>
                              <td className="text-center p-2">
                                {result.error ? '-' : (result.evaluation?.semanticDiversity || 0).toFixed(2)}
                              </td>
                              <td className="text-center p-2">
                                ${result.cost.total.toFixed(4)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  
                  {/* Copy Results Button */}
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyBatchResults}
                    >
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      <span className="ml-2">Copy Results for Analysis</span>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          
          {/* Single Test Results */}
          {results && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Test Results</CardTitle>
                  <CardDescription>
                    Model: {results.model} | Time: {results.timeMs}ms
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {results.error ? (
                    <Alert variant="destructive">
                      <AlertDescription>{results.error}</AlertDescription>
                    </Alert>
                  ) : (
                    <div className="space-y-4">
                      {/* Overall Score */}
                      {results.evaluation && (
                        <div className="p-4 bg-primary/10 rounded-lg">
                          <div className="text-sm text-muted-foreground mb-2">Overall Expansion Score</div>
                          <div className="text-4xl font-bold text-primary">
                            {results.evaluation.overallScore}/100
                          </div>
                        </div>
                      )}
                      
                      {/* Topic Expansion Distribution */}
                      {results.evaluation && (
                        <div className="p-3 bg-muted rounded">
                          <div className="text-sm text-muted-foreground mb-2">Topic Expansion Quality</div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs w-24">Too Close:</span>
                              <div className="flex-1 bg-background rounded-full h-4">
                                <div 
                                  className="bg-red-500 h-full rounded-full"
                                  style={{width: `${(results.evaluation.topicDistance.level1_tooClose / results.queryCount) * 100}%`}}
                                />
                              </div>
                              <span className="text-xs w-12 text-right">{Math.round((results.evaluation.topicDistance.level1_tooClose / results.queryCount) * 100)}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs w-24">Good Start:</span>
                              <div className="flex-1 bg-background rounded-full h-4">
                                <div 
                                  className="bg-yellow-500 h-full rounded-full"
                                  style={{width: `${(results.evaluation.topicDistance.level2_goodStart / results.queryCount) * 100}%`}}
                                />
                              </div>
                              <span className="text-xs w-12 text-right">{Math.round((results.evaluation.topicDistance.level2_goodStart / results.queryCount) * 100)}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs w-24">Sweet Spot:</span>
                              <div className="flex-1 bg-background rounded-full h-4">
                                <div 
                                  className="bg-green-500 h-full rounded-full"
                                  style={{width: `${(results.evaluation.topicDistance.level3_sweetSpot / results.queryCount) * 100}%`}}
                                />
                              </div>
                              <span className="text-xs w-12 text-right">{Math.round((results.evaluation.topicDistance.level3_sweetSpot / results.queryCount) * 100)}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs w-24">Wide Net:</span>
                              <div className="flex-1 bg-background rounded-full h-4">
                                <div 
                                  className="bg-blue-500 h-full rounded-full"
                                  style={{width: `${(results.evaluation.topicDistance.level4_wideNet / results.queryCount) * 100}%`}}
                                />
                              </div>
                              <span className="text-xs w-12 text-right">{Math.round((results.evaluation.topicDistance.level4_wideNet / results.queryCount) * 100)}%</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs w-24">Too Broad:</span>
                              <div className="flex-1 bg-background rounded-full h-4">
                                <div 
                                  className="bg-purple-500 h-full rounded-full"
                                  style={{width: `${(results.evaluation.topicDistance.level5_tooBroad / results.queryCount) * 100}%`}}
                                />
                              </div>
                              <span className="text-xs w-12 text-right">{Math.round((results.evaluation.topicDistance.level5_tooBroad / results.queryCount) * 100)}%</span>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Key Metrics */}
                      {results.evaluation && (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="p-3 bg-muted rounded">
                            <div className="text-sm text-muted-foreground">Category Coverage</div>
                            <div className="text-2xl font-bold">{results.evaluation.categoryCount}</div>
                            <div className="text-xs text-muted-foreground">unique categories</div>
                          </div>
                          <div className="p-3 bg-muted rounded">
                            <div className="text-sm text-muted-foreground">Semantic Diversity</div>
                            <div className="text-2xl font-bold">{results.evaluation.semanticDiversity.toFixed(2)}</div>
                            <div className="text-xs text-muted-foreground">0-1 scale</div>
                          </div>
                          <div className="p-3 bg-muted rounded">
                            <div className="text-sm text-muted-foreground">Est. Video Pool</div>
                            <div className="text-2xl font-bold">{results.evaluation.estimatedVideoPool.toLocaleString()}</div>
                            <div className="text-xs text-muted-foreground">videos</div>
                          </div>
                          <div className="p-3 bg-muted rounded">
                            <div className="text-sm text-muted-foreground">Total Queries</div>
                            <div className="text-2xl font-bold">{results.queryCount}</div>
                            <div className="text-xs text-muted-foreground">across {results.threads.length} threads</div>
                          </div>
                        </div>
                      )}
                      
                      {/* Quality Indicators */}
                      {results.evaluation && (
                        <div className="p-3 bg-muted rounded">
                          <div className="text-sm text-muted-foreground mb-2">Quality Indicators</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${results.evaluation.expansionQuality.progressiveWidening ? 'bg-green-500' : 'bg-red-500'}`} />
                              Progressive Widening
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${results.evaluation.expansionQuality.maintainsRelevance ? 'bg-green-500' : 'bg-red-500'}`} />
                              Maintains Relevance
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${results.evaluation.expansionQuality.exploresNewAudiences ? 'bg-green-500' : 'bg-red-500'}`} />
                              Explores New Audiences
                            </div>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${results.evaluation.expansionQuality.smoothTransitions ? 'bg-green-500' : 'bg-red-500'}`} />
                              Smooth Transitions
                            </div>
                          </div>
                          {(results.evaluation.expansionQuality.tooLiteral > 0 || 
                            results.evaluation.expansionQuality.repetitiveQueries > 0) && (
                            <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                              Issues: {results.evaluation.expansionQuality.tooLiteral} too literal, 
                              {results.evaluation.expansionQuality.repetitiveQueries} repetitive queries
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="p-3 bg-muted rounded">
                        <div className="text-sm text-muted-foreground mb-2">Cost Breakdown</div>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Input:</span>
                            <span className="ml-1">${results.cost.input.toFixed(4)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Output:</span>
                            <span className="ml-1">${results.cost.output.toFixed(4)}</span>
                          </div>
                          <div className="font-bold">
                            <span className="text-muted-foreground">Total:</span>
                            <span className="ml-1">${results.cost.total.toFixed(4)}</span>
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-2">
                          Tokens: {results.tokensUsed.input.toLocaleString()} in / {results.tokensUsed.output.toLocaleString()} out
                        </div>
                      </div>
                      
                      {/* Thread Analysis */}
                      {results.evaluation && (
                        <div className="p-3 bg-muted rounded">
                          <div className="text-sm text-muted-foreground mb-2">Thread Progression Analysis</div>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {results.evaluation.threadEvaluations.slice(0, 5).map((threadEval, i) => (
                              <div key={i} className="text-xs flex items-center justify-between">
                                <span className="truncate flex-1">{threadEval.threadName}</span>
                                <div className="flex items-center gap-2 ml-2">
                                  <span className="text-muted-foreground">D:</span>
                                  <span>{threadEval.startingDistance.toFixed(1)}→{threadEval.endingDistance.toFixed(1)}</span>
                                  <span className="text-muted-foreground">P:</span>
                                  <span className={threadEval.progressionScore > 0.5 ? 'text-green-600' : 'text-yellow-600'}>
                                    {(threadEval.progressionScore * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            D: Distance (1-5), P: Progression Score
                          </div>
                        </div>
                      )}
                      
                      <div className="flex justify-between items-center">
                        <h3 className="text-sm font-medium">Generated Threads</h3>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={copyResults}
                        >
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {results.threads.map((thread: any, i: number) => (
                          <div key={i} className="p-3 border rounded text-sm">
                            <div className="font-medium mb-1">Thread {i + 1}: {thread.angle || thread.threadName}</div>
                            <div className="text-xs text-muted-foreground mb-2">{thread.intent}</div>
                            <ul className="space-y-1">
                              {thread.queries.map((q: string, j: number) => {
                                const hasProhibited = q.toLowerCase().includes('laser') || 
                                  q.toLowerCase().includes('xtool') ||
                                  q.toLowerCase().includes('fiber');
                                return (
                                  <li key={j} className={`text-xs ${hasProhibited ? 'text-red-500' : ''}`}>
                                    • {q}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}