'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Lightbulb, TrendingUp, Users, Clock } from 'lucide-react';

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
            maxSuggestions: 5,
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

  const exampleConcepts = [
    'beginner woodworking mistakes',
    'home cooking tips',
    'productivity hacks',
    'guitar practice routine',
    'budget travel planning'
  ];

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">YouTube Title Generator</h1>
        <p className="text-gray-600">
          Generate high-performing video titles based on patterns from 100K+ videos
        </p>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Enter Your Video Concept</CardTitle>
          <CardDescription>
            Describe your video idea and we'll suggest titles that work in similar content spaces
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="concept">Video Concept</Label>
              <Input
                id="concept"
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                placeholder="e.g., beginner woodworking mistakes"
                className="mt-1"
              />
            </div>
            
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-gray-500">Examples:</span>
              {exampleConcepts.map((example) => (
                <Button
                  key={example}
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setConcept(example)}
                  className="text-xs"
                >
                  {example}
                </Button>
              ))}
            </div>
            
            <Button type="submit" disabled={!concept.trim() || isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Lightbulb className="mr-2 h-4 w-4" />
                  Generate Titles
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-8 border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-600">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {results && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Results for "{results.concept}"</CardTitle>
              <CardDescription>
                Found {results.suggestions.length} title suggestions from {results.total_patterns_searched} patterns 
                across {results.semantic_neighborhoods_found} semantic neighborhoods 
                (processed in {results.processing_time_ms}ms)
              </CardDescription>
            </CardHeader>
          </Card>

          <div className="grid gap-4">
            {results.suggestions.map((suggestion, index) => (
              <Card key={index} className="relative">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-2 text-blue-600">
                        {suggestion.title}
                      </CardTitle>
                      <CardDescription className="mb-3">
                        {suggestion.explanation}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        {suggestion.pattern.performance_lift.toFixed(1)}x
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-gray-500" />
                      <span className="text-sm">
                        {suggestion.evidence.sample_size} videos
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-gray-500" />
                      <span className="text-sm">
                        {suggestion.evidence.avg_performance.toFixed(1)}x avg performance
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-gray-500" />
                      <span className="text-sm">
                        {Math.round(suggestion.evidence.confidence_score * 100)}% confidence
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold text-sm mb-2">Pattern Details</h4>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{suggestion.pattern.name}</Badge>
                        {suggestion.pattern.template && (
                          <Badge variant="outline" className="font-mono text-xs">
                            {suggestion.pattern.template}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {suggestion.pattern.examples.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-sm mb-2">Similar Examples</h4>
                        <div className="bg-gray-50 p-3 rounded-lg">
                          <ul className="text-sm space-y-1">
                            {suggestion.pattern.examples.slice(0, 3).map((example, i) => (
                              <li key={i} className="text-gray-700">
                                • {example}
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
            <Card>
              <CardContent className="pt-6">
                <p className="text-gray-600">
                  No title suggestions found for this concept. Try a different topic or check that pattern discovery has been run.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}