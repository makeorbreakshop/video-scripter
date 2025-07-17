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
  Sparkles,
  TrendingUp, 
  Users, 
  BarChart3,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Play,
  ExternalLink,
  Target
} from 'lucide-react';

interface TitleSuggestion {
  title: string;
  pattern: {
    id: string;
    name: string;
    template?: string;
    performance_lift: number;
    examples: string[];
    video_ids?: string[];
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

interface Video {
  id: string;
  title: string;
  channel_name: string;
  view_count: number;
  published_at: string;
  thumbnail_url: string;
}

export default function TitleGeneratorPageRedesigned() {
  const [concept, setConcept] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TitleGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [loadingVideos, setLoadingVideos] = useState<Record<number, boolean>>({});
  const [patternVideos, setPatternVideos] = useState<Record<number, Video[]>>({});
  const [expandedPattern, setExpandedPattern] = useState<number | null>(null);

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

  const fetchPatternVideos = async (index: number, videoIds: string[]) => {
    if (!videoIds || videoIds.length === 0) return;
    
    setLoadingVideos(prev => ({ ...prev, [index]: true }));
    
    try {
      const response = await fetch('/api/youtube/videos/by-ids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoIds }),
      });

      if (response.ok) {
        const data = await response.json();
        setPatternVideos(prev => ({ ...prev, [index]: data.videos }));
      }
    } catch (err) {
      console.error('Failed to fetch videos:', err);
    } finally {
      setLoadingVideos(prev => ({ ...prev, [index]: false }));
    }
  };

  const togglePatternExpansion = (index: number) => {
    if (expandedPattern === index) {
      setExpandedPattern(null);
    } else {
      setExpandedPattern(index);
      if (!patternVideos[index] && results?.suggestions[index].pattern.video_ids) {
        fetchPatternVideos(index, results.suggestions[index].pattern.video_ids);
      }
    }
  };

  const exampleConcepts = [
    { text: 'beginner woodworking', icon: '🪵' },
    { text: 'cooking for families', icon: '👨‍👩‍👧‍👦' },
    { text: 'productivity tips', icon: '⚡' },
    { text: 'guitar lessons', icon: '🎸' },
    { text: 'budget travel', icon: '✈️' },
    { text: 'home fitness', icon: '💪' }
  ];

  const getPerformanceLevel = (lift: number) => {
    if (lift >= 100) return { label: 'Exceptional', color: 'bg-purple-500 text-white' };
    if (lift >= 50) return { label: 'Excellent', color: 'bg-green-500 text-white' };
    if (lift >= 20) return { label: 'Very Good', color: 'bg-blue-500 text-white' };
    if (lift >= 10) return { label: 'Good', color: 'bg-sky-500 text-white' };
    return { label: 'Moderate', color: 'bg-gray-500 text-white' };
  };

  const getConfidenceIcon = (score: number) => {
    if (score >= 0.8) return '🟢';
    if (score >= 0.6) return '🟡';
    return '🔴';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-12 max-w-5xl">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
              <Sparkles className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-3">
              AI-Powered Title Generator
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Generate high-performing YouTube titles based on patterns from 100K+ successful videos
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Input Section */}
        <Card className="mb-8 border-0 shadow-lg">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label htmlFor="concept" className="text-base font-medium mb-2 block">
                  What's your video about?
                </Label>
                <div className="relative">
                  <Input
                    id="concept"
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    placeholder="e.g., beginner woodworking mistakes"
                    className="h-14 text-lg pr-32 rounded-xl"
                  />
                  <Button 
                    type="submit" 
                    disabled={!concept.trim() || isLoading}
                    className="absolute right-2 top-2 h-10 px-6 rounded-lg"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
              </div>
              
              <div>
                <p className="text-sm text-gray-500 mb-3">Try these popular concepts:</p>
                <div className="flex flex-wrap gap-2">
                  {exampleConcepts.map((example) => (
                    <Button
                      key={example.text}
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setConcept(example.text)}
                      className="rounded-full hover:bg-gray-100 transition-colors"
                    >
                      <span className="mr-1">{example.icon}</span>
                      {example.text}
                    </Button>
                  ))}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700">
            <p className="font-medium">Error: {error}</p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-6">
            {/* Results Summary */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-1">
                    Results for "{results.concept}"
                  </h2>
                  <p className="text-gray-600">
                    Found {results.suggestions.length} title patterns from analyzing similar high-performing videos
                  </p>
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="text-center">
                    <div className="font-bold text-gray-900">{results.total_patterns_searched}</div>
                    <div className="text-gray-500">Patterns</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-gray-900">{results.processing_time_ms}ms</div>
                    <div className="text-gray-500">Processing</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Title Suggestions */}
            <div className="space-y-4">
              {results.suggestions.map((suggestion, index) => {
                const performanceLevel = getPerformanceLevel(suggestion.pattern.performance_lift);
                const isExpanded = expandedPattern === index;
                
                return (
                  <Card key={index} className="border-0 shadow-md hover:shadow-lg transition-shadow">
                    <CardContent className="p-6">
                      {/* Title and Copy Button */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 mr-4">
                          <h3 className="text-xl font-semibold text-gray-900 mb-2">
                            {suggestion.title}
                          </h3>
                          <p className="text-gray-600">
                            {suggestion.explanation}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(suggestion.title, index)}
                          className="flex-shrink-0"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-5 w-5 text-green-600" />
                          ) : (
                            <Copy className="h-5 w-5" />
                          )}
                        </Button>
                      </div>

                      {/* Metrics */}
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <TrendingUp className="h-5 w-5 text-gray-600 mx-auto mb-1" />
                          <div className="font-bold text-lg">{suggestion.pattern.performance_lift.toFixed(1)}x</div>
                          <div className="text-xs text-gray-500">Performance</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <Users className="h-5 w-5 text-gray-600 mx-auto mb-1" />
                          <div className="font-bold text-lg">{suggestion.evidence.sample_size}</div>
                          <div className="text-xs text-gray-500">Videos</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <BarChart3 className="h-5 w-5 text-gray-600 mx-auto mb-1" />
                          <div className="font-bold text-lg">
                            {getConfidenceIcon(suggestion.evidence.confidence_score)} {Math.round(suggestion.evidence.confidence_score * 100)}%
                          </div>
                          <div className="text-xs text-gray-500">Confidence</div>
                        </div>
                      </div>

                      {/* Pattern Info */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge className={performanceLevel.color}>
                            {performanceLevel.label}
                          </Badge>
                          <Badge variant="outline">
                            {suggestion.pattern.name}
                          </Badge>
                          {suggestion.pattern.template && (
                            <Badge variant="outline" className="font-mono text-xs">
                              {suggestion.pattern.template}
                            </Badge>
                          )}
                        </div>
                        
                        {suggestion.pattern.video_ids && suggestion.pattern.video_ids.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => togglePatternExpansion(index)}
                            className="text-gray-600"
                          >
                            View Evidence
                            {isExpanded ? (
                              <ChevronUp className="ml-1 h-4 w-4" />
                            ) : (
                              <ChevronDown className="ml-1 h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t">
                          {/* Examples */}
                          {suggestion.pattern.examples.length > 0 && (
                            <div className="mb-4">
                              <h4 className="font-medium text-sm text-gray-700 mb-2">Example Titles</h4>
                              <div className="bg-gray-50 rounded-lg p-3">
                                <ul className="space-y-1">
                                  {suggestion.pattern.examples.map((example, i) => (
                                    <li key={i} className="text-sm text-gray-700 flex items-start">
                                      <span className="text-blue-500 mr-2">•</span>
                                      {example}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}

                          {/* Videos */}
                          {loadingVideos[index] ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                            </div>
                          ) : patternVideos[index] ? (
                            <div>
                              <h4 className="font-medium text-sm text-gray-700 mb-3">Videos Using This Pattern</h4>
                              <div className="grid gap-3">
                                {patternVideos[index].map((video) => (
                                  <div key={video.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                                    {video.thumbnail_url && (
                                      <div className="relative flex-shrink-0">
                                        <img 
                                          src={video.thumbnail_url} 
                                          alt={video.title}
                                          className="w-32 h-20 object-cover rounded-lg"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 hover:bg-opacity-30 transition-opacity rounded-lg">
                                          <Play className="h-8 w-8 text-white opacity-0 hover:opacity-100 transition-opacity" />
                                        </div>
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <h5 className="font-medium text-sm text-gray-900 truncate mb-1">
                                        {video.title}
                                      </h5>
                                      <div className="flex items-center gap-3 text-xs text-gray-600">
                                        <span>{video.channel_name}</span>
                                        <span>•</span>
                                        <span>{video.view_count.toLocaleString()} views</span>
                                      </div>
                                    </div>
                                    <a 
                                      href={`https://youtube.com/watch?v=${video.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex-shrink-0"
                                    >
                                      <ExternalLink className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Empty State */}
            {results.suggestions.length === 0 && (
              <Card className="border-0 shadow-md">
                <CardContent className="pt-12 pb-12 text-center">
                  <Target className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No patterns found</h3>
                  <p className="text-gray-600 max-w-md mx-auto">
                    We couldn't find title patterns for this concept. Try a different topic or check that your video database has been populated.
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