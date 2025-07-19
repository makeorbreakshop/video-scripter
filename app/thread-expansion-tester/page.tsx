'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Copy, Check } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PROMPTS } from './prompts';

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

const DEFAULT_PROMPT = `Analyze this concept: "{concept}"

Your task: Create 15 search threads that intelligently explore related content patterns.

First, decompose the concept into abstract components:
- Core function/purpose (what problem does it solve?)
- Target audience (who uses this and why?)
- Category/domain (what broader field does this belong to?)
- Stage in process (is this a tool, technique, end product?)

Then create 15 threads following this expansion strategy:

THREADS 1-5: ABSTRACTION & GENERALIZATION
- Thread 1: Remove ALL brand/product names - search the general category only
- Thread 2: Search for the PROBLEM being solved, not the solution
- Thread 3: Look for OTHER solutions to the same problem (no mention of original)
- Thread 4: Search the broader activity/hobby/profession this relates to
- Thread 5: Find content about the skills/knowledge needed, not the tools

THREADS 6-10: ADJACENT DOMAINS
- Thread 6: Related hobbies/activities that share similar audiences
- Thread 7: Different tools/methods that achieve similar outcomes
- Thread 8: Educational content about the underlying principles
- Thread 9: Career/business aspects of the broader field
- Thread 10: Creative applications across different industries

THREADS 11-15: AUDIENCE EXPANSION
- Thread 11: Content for complete beginners to the general field
- Thread 12: Advanced techniques in the broader domain
- Thread 13: Popular creators/channels in the category (not product-specific)
- Thread 14: Trending topics in the wider industry
- Thread 15: Budget/DIY alternatives to professional solutions

CRITICAL RULES:
1. For Thread 1: If given "xTool F2 fiber laser", search "engraving machines" NOT "fiber laser"
2. For Thread 2: If it's about cutting metal, search "metal fabrication" NOT "laser cutting"
3. For Thread 3: Search "CNC routers", "plasma cutters", "waterjet" NOT "laser alternatives"
4. NEVER include the original product name or specific technology in queries
5. Think broadly about WHO uses this and WHAT ELSE they might be interested in

Generate 5 queries per thread that explore these angles WITHOUT mentioning the specific product/brand.`;

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
  error?: string;
}

export default function ThreadExpansionTester() {
  const [concept, setConcept] = useState('xTool F2 fiber laser review');
  const [prompt, setPrompt] = useState(PROMPTS.topicFormatExpansion);
  const [selectedModel, setSelectedModel] = useState<ModelId>('claude-3-5-sonnet-20241022');
  const [selectedPromptStrategy, setSelectedPromptStrategy] = useState<keyof typeof PROMPTS>('topicFormatExpansion');
  const [temperature, setTemperature] = useState(0.8);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TestResult | null>(null);
  const [copied, setCopied] = useState(false);

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
          timeMs: Date.now() - startTime
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

  const copyResults = () => {
    if (results && !results.error) {
      const text = JSON.stringify(results.threads, null, 2);
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
                    <SelectItem value="topicFormatExpansion">Topic→Format Expansion (NEW)</SelectItem>
                    <SelectItem value="formatFirstApproach">Format-First Approach</SelectItem>
                    <SelectItem value="audiencePsychologyApproach">Audience Psychology</SelectItem>
                    <SelectItem value="viralPatternMining">Viral Pattern Mining</SelectItem>
                    <SelectItem value="humanCentered">Human-Centered</SelectItem>
                    <SelectItem value="stepByStep">Step-by-Step Analysis</SelectItem>
                    <SelectItem value="fewShot">Few-Shot Learning</SelectItem>
                    <SelectItem value="chainOfThought">Chain of Thought</SelectItem>
                    <SelectItem value="personaBased">Persona-Based</SelectItem>
                    <SelectItem value="abstract">Ultra-Abstract</SelectItem>
                    <SelectItem value="metaphorical">Metaphorical Thinking</SelectItem>
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
              
              <Button 
                onClick={runTest} 
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Run Test'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
        
        {/* Results Panel */}
        <div className="space-y-6">
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 bg-muted rounded">
                          <div className="text-sm text-muted-foreground">Total Queries</div>
                          <div className="text-2xl font-bold">{results.queryCount}</div>
                        </div>
                        <div className="p-3 bg-muted rounded">
                          <div className="text-sm text-muted-foreground">Prohibited Terms</div>
                          <div className="text-2xl font-bold text-red-500">
                            {results.prohibitedTerms} ({Math.round(results.prohibitedTerms / results.queryCount * 100)}%)
                          </div>
                        </div>
                      </div>
                      
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
                      
                      <div className="p-3 bg-muted rounded">
                        <div className="text-sm text-muted-foreground mb-2">Sample Diverse Queries</div>
                        <div className="space-y-1">
                          {results.threads.slice(0, 5).map((thread: any, i: number) => {
                            const query = thread.queries[0];
                            const hasProhibited = query.toLowerCase().includes('laser') || 
                              query.toLowerCase().includes('xtool') ||
                              query.toLowerCase().includes('fiber');
                            return (
                              <div key={i} className={`text-xs ${hasProhibited ? 'text-red-500' : 'text-green-600'}`}>
                                Thread {i + 1}: {query}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      
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