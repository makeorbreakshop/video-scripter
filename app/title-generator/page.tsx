'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Loader2, 
  Lightbulb, 
  TrendingUp, 
  Users, 
  Clock, 
  Target,
  Zap,
  Copy,
  Check
} from 'lucide-react';

interface TitleSuggestion {
  title: string;
  pattern: {
    id: string;
    name: string;
    template?: string;
    performance_lift: number;
    examples: string[];
  };
  evidence: {
    sample_size: number;
    avg_performance: number;
    confidence_score: number;
  };
  explanation: string;
  similarity_score: number;
}

interface TitleGenerationResponse {
  suggestions: TitleSuggestion[];
  concept: string;
  total_patterns_searched: number;
  semantic_neighborhoods_found: number;
  processing_time_ms: number;
}

export default function TitleGeneratorPage() {
  const [concept, setConcept] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TitleGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch('/api/youtube/patterns/generate-titles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          concept: concept.trim(),
          options: {
            maxSuggestions: 8,
            includeExamples: true
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate titles');
      }

      const data: TitleGenerationResponse = await response.json();
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const exampleConcepts = [
    'beginner woodworking mistakes',
    'home cooking tips for busy parents',
    'productivity hacks for remote workers',
    'guitar practice routine',
    'budget travel planning',
    'DIY home improvement projects',
    'small business marketing strategies',
    'fitness routines for beginners'
  ];

  const getPerformanceColor = (lift: number) => {
    if (lift >= 3) return 'text-green-600 bg-green-50';
    if (lift >= 2) return 'text-blue-600 bg-blue-50';
    if (lift >= 1.5) return 'text-amber-600 bg-amber-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600';
    if (score >= 0.6) return 'text-blue-600';
    if (score >= 0.4) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex justify-center items-center mb-4">
            <div className="p-3 bg-blue-600 rounded-full">
              <Target className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">
            YouTube Title Generator
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Generate high-performing video titles using AI analysis of 100K+ videos. 
            Get contextual suggestions based on what actually works in your content space.
          </p>
        </div>

        {/* Input Form */}
        <Card className="mb-8 shadow-lg border-0">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-blue-600" />
              Enter Your Video Concept
            </CardTitle>
            <CardDescription>
              Describe your video idea and we'll analyze similar content to suggest titles that perform well
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label htmlFor="concept" className="text-sm font-medium">Video Concept</Label>
                <Input
                  id="concept"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="e.g., beginner woodworking mistakes"
                  className="mt-1 h-12 text-lg"
                />
              </div>
              
              <div className="space-y-3">
                <span className="text-sm font-medium text-gray-700">Example concepts:</span>
                <div className="flex flex-wrap gap-2">
                  {exampleConcepts.map((example) => (
                    <Button
                      key={example}
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setConcept(example)}
                      className="text-sm hover:bg-blue-50 hover:border-blue-300"
                    >
                      {example}
                    </Button>
                  ))}
                </div>
              </div>
              
              <Button 
                type="submit" 
                disabled={!concept.trim() || isLoading}
                className="w-full h-12 text-lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Analyzing patterns...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-5 w-5" />
                    Generate Titles
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Error */}
        {error && (
          <Card className="mb-8 border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-red-600 font-medium">Error: {error}</p>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-6">
            {/* Results Header */}
            <Card className="border-0 shadow-lg bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <CardHeader>
                <CardTitle className="text-2xl">
                  Results for "{results.concept}"
                </CardTitle>
                <CardDescription className="text-blue-100">
                  Found {results.suggestions.length} title suggestions from {results.total_patterns_searched} patterns 
                  across {results.semantic_neighborhoods_found} semantic neighborhoods 
                  (processed in {results.processing_time_ms}ms)
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Title Suggestions */}
            <div className="grid gap-6">
              {results.suggestions.map((suggestion, index) => (
                <Card key={index} className="border-0 shadow-lg hover:shadow-xl transition-shadow">
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-3">
                          <CardTitle className="text-xl text-gray-900">
                            {suggestion.title}
                          </CardTitle>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(suggestion.title, index)}
                            className="h-8 w-8 p-0"
                          >
                            {copiedIndex === index ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        <CardDescription className="text-base">
                          {suggestion.explanation}
                        </CardDescription>
                      </div>
                      <Badge 
                        variant="secondary" 
                        className={`flex items-center gap-1 px-3 py-1 ${getPerformanceColor(suggestion.pattern.performance_lift)}`}
                      >
                        <TrendingUp className="h-3 w-3" />
                        {suggestion.pattern.performance_lift.toFixed(1)}x
                      </Badge>
                    </div>
                  </CardHeader>
                  
                  <CardContent>
                    {/* Evidence Metrics */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                      <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        <Users className="h-5 w-5 text-gray-600" />
                        <div>
                          <div className="font-medium">{suggestion.evidence.sample_size}</div>
                          <div className="text-sm text-gray-600">videos analyzed</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        <TrendingUp className="h-5 w-5 text-gray-600" />
                        <div>
                          <div className="font-medium">{suggestion.evidence.avg_performance.toFixed(1)}x</div>
                          <div className="text-sm text-gray-600">avg performance</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                        <Clock className="h-5 w-5 text-gray-600" />
                        <div>
                          <div className={`font-medium ${getConfidenceColor(suggestion.evidence.confidence_score)}`}>
                            {Math.round(suggestion.evidence.confidence_score * 100)}%
                          </div>
                          <div className="text-sm text-gray-600">confidence</div>
                        </div>
                      </div>
                    </div>

                    <Separator className="my-4" />

                    {/* Pattern Details */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold text-sm mb-2 text-gray-700">Pattern Details</h4>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline" className="border-blue-200 text-blue-700">
                            {suggestion.pattern.name}
                          </Badge>
                          {suggestion.pattern.template && (
                            <Badge variant="outline" className="font-mono text-xs border-gray-300">
                              {suggestion.pattern.template}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {suggestion.pattern.examples.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-2 text-gray-700">Similar High-Performing Examples</h4>
                          <div className="bg-gray-50 p-4 rounded-lg">
                            <ul className="space-y-2">
                              {suggestion.pattern.examples.slice(0, 4).map((example, i) => (
                                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                                  <span className="text-blue-600 font-medium">•</span>
                                  <span>{example}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {results.suggestions.length === 0 && (
              <Card className="border-0 shadow-lg">
                <CardContent className="pt-6 text-center">
                  <div className="text-gray-500 mb-2">
                    <Target className="h-12 w-12 mx-auto mb-3" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No patterns found</h3>
                  <p className="text-gray-600">
                    No title suggestions found for this concept. Try a different topic or check that your video database has been populated.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}