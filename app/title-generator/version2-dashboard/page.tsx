'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Loader2,
  Sparkles,
  TrendingUp,
  Users,
  BarChart3,
  Copy,
  Check,
  Search,
  Activity,
  Zap,
  ExternalLink
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

export default function TitleGeneratorV2() {
  const [concept, setConcept] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TitleGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [loadingVideos, setLoadingVideos] = useState<Record<number, boolean>>({});
  const [patternVideos, setPatternVideos] = useState<Record<number, Video[]>>({});
  const [selectedSuggestion, setSelectedSuggestion] = useState<number>(0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);
    setSelectedSuggestion(0);

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

  const quickExamples = [
    { icon: '🛠️', text: 'DIY projects' },
    { icon: '🍳', text: 'cooking tutorials' },
    { icon: '💻', text: 'coding tips' },
    { icon: '📸', text: 'photography basics' }
  ];

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="container max-w-7xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Title Generator</h1>
          <p className="text-gray-600">Discover high-performing title patterns from 100K+ videos</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel - Search & Input */}
          <div className="lg:col-span-1 space-y-6">
            {/* Search Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  New Search
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Input
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    placeholder="Enter your video topic..."
                    className="w-full text-gray-900 bg-white border-gray-200 placeholder:text-gray-400"
                  />
                  <Button 
                    type="submit" 
                    disabled={!concept.trim() || isLoading}
                    className="w-full"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate Titles
                      </>
                    )}
                  </Button>
                </form>

                {/* Quick Examples */}
                <div className="mt-4">
                  <p className="text-sm text-gray-500 mb-2">Quick examples:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {quickExamples.map((example) => (
                      <button
                        key={example.text}
                        onClick={() => setConcept(example.text)}
                        className="text-left p-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                      >
                        <span className="mr-1">{example.icon}</span>
                        {example.text}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats Card */}
            {results && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Analysis Stats
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Patterns Found</span>
                    <span className="font-medium">{results.suggestions.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Videos Analyzed</span>
                    <span className="font-medium">{results.total_patterns_searched}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Processing Time</span>
                    <span className="font-medium">{(results.processing_time_ms / 1000).toFixed(1)}s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Avg Performance</span>
                    <span className="font-medium text-green-600">
                      {(results.suggestions.reduce((acc, s) => acc + s.pattern.performance_lift, 0) / results.suggestions.length).toFixed(1)}x
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel - Results */}
          <div className="lg:col-span-2">
            {error && (
              <Card className="border-red-200 bg-red-50">
                <CardContent className="p-4">
                  <p className="text-red-600">{error}</p>
                </CardContent>
              </Card>
            )}

            {results ? (
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>Generated Titles for "{results.concept}"</CardTitle>
                  <CardDescription>
                    Select a title to see detailed analysis and evidence
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs value={selectedSuggestion.toString()} onValueChange={(v) => setSelectedSuggestion(parseInt(v))}>
                    <TabsList className="grid grid-cols-2 lg:grid-cols-4 mb-6">
                      {results.suggestions.slice(0, 4).map((_, index) => (
                        <TabsTrigger key={index} value={index.toString()}>
                          Title {index + 1}
                        </TabsTrigger>
                      ))}
                    </TabsList>

                    {results.suggestions.map((suggestion, index) => (
                      <TabsContent key={index} value={index.toString()} className="space-y-6">
                        {/* Title Display */}
                        <div className="bg-gray-50 p-6 rounded-lg">
                          <div className="flex items-start justify-between mb-4">
                            <h3 className="text-xl font-medium text-gray-900 flex-1 mr-4">
                              {suggestion.title}
                            </h3>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => copyToClipboard(suggestion.title, index)}
                            >
                              {copiedIndex === index ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                          <p className="text-gray-600 mb-4">{suggestion.explanation}</p>
                          
                          {/* Performance Badges */}
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="secondary" className="gap-1">
                              <TrendingUp className="h-3 w-3" />
                              {suggestion.pattern.performance_lift.toFixed(1)}x performance
                            </Badge>
                            <Badge variant="secondary" className="gap-1">
                              <Users className="h-3 w-3" />
                              {suggestion.evidence.sample_size} videos
                            </Badge>
                            <Badge variant="secondary" className="gap-1">
                              <BarChart3 className="h-3 w-3" />
                              {Math.round(suggestion.evidence.confidence_score * 100)}% confidence
                            </Badge>
                            {suggestion.pattern.name && (
                              <Badge variant="outline">
                                {suggestion.pattern.name}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Pattern Details */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <Card className="border-green-200 bg-green-50/50">
                            <CardContent className="pt-6">
                              <div className="flex items-center gap-2 mb-2">
                                <Zap className="h-5 w-5 text-green-600" />
                                <span className="font-medium text-green-900">Performance</span>
                              </div>
                              <p className="text-2xl font-semibold text-green-900">
                                {suggestion.pattern.performance_lift.toFixed(1)}x
                              </p>
                              <p className="text-sm text-green-700 mt-1">
                                Better than average
                              </p>
                            </CardContent>
                          </Card>

                          <Card className="border-blue-200 bg-blue-50/50">
                            <CardContent className="pt-6">
                              <div className="flex items-center gap-2 mb-2">
                                <Users className="h-5 w-5 text-blue-600" />
                                <span className="font-medium text-blue-900">Sample Size</span>
                              </div>
                              <p className="text-2xl font-semibold text-blue-900">
                                {suggestion.evidence.sample_size}
                              </p>
                              <p className="text-sm text-blue-700 mt-1">
                                Videos analyzed
                              </p>
                            </CardContent>
                          </Card>

                          <Card className="border-purple-200 bg-purple-50/50">
                            <CardContent className="pt-6">
                              <div className="flex items-center gap-2 mb-2">
                                <BarChart3 className="h-5 w-5 text-purple-600" />
                                <span className="font-medium text-purple-900">Confidence</span>
                              </div>
                              <p className="text-2xl font-semibold text-purple-900">
                                {Math.round(suggestion.evidence.confidence_score * 100)}%
                              </p>
                              <p className="text-sm text-purple-700 mt-1">
                                Statistical confidence
                              </p>
                            </CardContent>
                          </Card>
                        </div>

                        {/* Evidence Videos */}
                        {suggestion.pattern.video_ids && suggestion.pattern.video_ids.length > 0 && (
                          <div>
                            <h4 className="font-medium mb-3">Videos using this pattern</h4>
                            {!patternVideos[index] && !loadingVideos[index] && (
                              <Button
                                variant="outline"
                                onClick={() => fetchPatternVideos(index, suggestion.pattern.video_ids!)}
                                className="w-full"
                              >
                                Load video evidence
                              </Button>
                            )}
                            
                            {loadingVideos[index] && (
                              <div className="flex justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                              </div>
                            )}
                            
                            {patternVideos[index] && (
                              <div className="grid gap-3">
                                {patternVideos[index].map((video) => (
                                  <a
                                    key={video.id}
                                    href={`https://youtube.com/watch?v=${video.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors group"
                                  >
                                    {video.thumbnail_url && (
                                      <img 
                                        src={video.thumbnail_url} 
                                        alt={video.title}
                                        className="w-28 h-16 object-cover rounded"
                                      />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm text-gray-900 truncate group-hover:text-blue-600">
                                        {video.title}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {video.channel_name} • {video.view_count.toLocaleString()} views
                                      </div>
                                    </div>
                                    <ExternalLink className="h-4 w-4 text-gray-400 group-hover:text-blue-600" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </TabsContent>
                    ))}
                  </Tabs>
                </CardContent>
              </Card>
            ) : !isLoading && (
              <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-16">
                  <Search className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No results yet</h3>
                  <p className="text-gray-600">Enter a video concept to generate title suggestions</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}