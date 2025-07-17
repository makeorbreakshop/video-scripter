'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2,
  Sparkles,
  TrendingUp,
  Users,
  BarChart3,
  Copy,
  Check,
  ArrowRight,
  Play,
  Lightbulb,
  Target,
  Brain
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

export default function TitleGeneratorV3() {
  const [concept, setConcept] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TitleGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [loadingVideos, setLoadingVideos] = useState<Record<number, boolean>>({});
  const [patternVideos, setPatternVideos] = useState<Record<number, Video[]>>({});
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);
    setExpandedCard(null);

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

  const getPerformanceColor = (lift: number) => {
    if (lift >= 50) return 'from-purple-500 to-pink-500';
    if (lift >= 20) return 'from-blue-500 to-cyan-500';
    if (lift >= 10) return 'from-green-500 to-emerald-500';
    return 'from-gray-500 to-gray-600';
  };

  const getConfidenceEmoji = (score: number) => {
    if (score >= 0.8) return '🔥';
    if (score >= 0.6) return '✨';
    return '💡';
  };

  const inspirationPrompts = [
    { icon: '🎯', text: 'product reviews' },
    { icon: '🚀', text: 'startup tips' },
    { icon: '🎨', text: 'design tutorials' },
    { icon: '🏋️', text: 'fitness routines' },
    { icon: '📚', text: 'study techniques' },
    { icon: '🌱', text: 'gardening hacks' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-white border-b">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-purple-50 opacity-50" />
        <div className="relative container max-w-6xl mx-auto px-4 py-16">
          <div className="text-center">
            <div className="inline-flex items-center justify-center p-3 bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl mb-6">
              <Brain className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              AI Title Lab
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Transform your ideas into viral titles using patterns from 100K+ successful videos
            </p>
          </div>

          {/* Search */}
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto mt-12">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-500" />
              <div className="relative flex">
                <Input
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  placeholder="What's your video about?"
                  className="flex-1 h-16 pl-6 pr-4 text-lg text-gray-900 bg-white border border-gray-200 rounded-l-2xl focus:ring-0 shadow-lg placeholder:text-gray-400"
                />
                <Button 
                  type="submit" 
                  disabled={!concept.trim() || isLoading}
                  className="h-16 px-8 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-r-2xl border-0 shadow-lg"
                >
                  {isLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-5 w-5" />
                      Generate Magic
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>

          {/* Inspiration */}
          <div className="flex flex-wrap gap-3 justify-center mt-8">
            {inspirationPrompts.map((prompt) => (
              <button
                key={prompt.text}
                onClick={() => setConcept(prompt.text)}
                className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 rounded-full text-sm font-medium text-gray-700 hover:text-gray-900 transition-all hover:scale-105 hover:shadow-md"
              >
                <span className="mr-2">{prompt.icon}</span>
                {prompt.text}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="container max-w-6xl mx-auto px-4 py-12">
        {error && (
          <div className="max-w-2xl mx-auto mb-8 p-6 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-center">
            <p className="font-medium">{error}</p>
          </div>
        )}

        {results && (
          <div className="space-y-8">
            {/* Analytics Bar */}
            <div className="flex flex-wrap gap-4 justify-center">
              <div className="bg-white rounded-xl px-6 py-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-600" />
                  <span className="text-2xl font-bold text-gray-900">{results.suggestions.length}</span>
                  <span className="text-gray-600">Titles Created</span>
                </div>
              </div>
              <div className="bg-white rounded-xl px-6 py-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-purple-600" />
                  <span className="text-2xl font-bold text-gray-900">{results.total_patterns_searched}</span>
                  <span className="text-gray-600">Patterns Analyzed</span>
                </div>
              </div>
              <div className="bg-white rounded-xl px-6 py-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-pink-600" />
                  <span className="text-2xl font-bold text-gray-900">
                    {(results.suggestions.reduce((acc, s) => acc + s.pattern.performance_lift, 0) / results.suggestions.length).toFixed(1)}x
                  </span>
                  <span className="text-gray-600">Avg Performance</span>
                </div>
              </div>
            </div>

            {/* Title Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {results.suggestions.map((suggestion, index) => {
                const isExpanded = expandedCard === index;
                const isHovered = hoveredCard === index;
                
                return (
                  <div
                    key={index}
                    className={cn(
                      "group relative transition-all duration-300",
                      isExpanded && "md:col-span-2"
                    )}
                    onMouseEnter={() => setHoveredCard(index)}
                    onMouseLeave={() => setHoveredCard(null)}
                  >
                    <div className={cn(
                      "absolute -inset-1 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition duration-500",
                      `bg-gradient-to-r ${getPerformanceColor(suggestion.pattern.performance_lift)}`
                    )} />
                    
                    <Card className="relative bg-white border-0 shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden">
                      <div className={cn(
                        "absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full blur-3xl opacity-20",
                        `bg-gradient-to-br ${getPerformanceColor(suggestion.pattern.performance_lift)}`
                      )} />
                      
                      <CardContent className="relative p-6">
                        {/* Title Section */}
                        <div className="mb-4">
                          <div className="flex items-start justify-between mb-3">
                            <h3 className="text-xl font-semibold text-gray-900 flex-1 mr-4 leading-tight">
                              {suggestion.title}
                            </h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(suggestion.title, index)}
                              className="flex-shrink-0 hover:bg-gray-100"
                            >
                              {copiedIndex === index ? (
                                <Check className="h-5 w-5 text-green-600" />
                              ) : (
                                <Copy className="h-5 w-5 text-gray-400" />
                              )}
                            </Button>
                          </div>
                          
                          {/* Performance Indicator */}
                          <div className="flex items-center gap-4 mb-3">
                            <div className={cn(
                              "inline-flex items-center gap-2 px-3 py-1 rounded-full text-white text-sm font-medium",
                              `bg-gradient-to-r ${getPerformanceColor(suggestion.pattern.performance_lift)}`
                            )}>
                              <TrendingUp className="h-4 w-4" />
                              {suggestion.pattern.performance_lift.toFixed(1)}x performance
                            </div>
                            <span className="text-2xl">{getConfidenceEmoji(suggestion.evidence.confidence_score)}</span>
                          </div>

                          <p className="text-gray-600 text-sm leading-relaxed">
                            {suggestion.explanation}
                          </p>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-3 gap-3 mb-4">
                          <div className="text-center p-3 bg-gray-50 rounded-xl">
                            <Users className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                            <div className="font-semibold text-gray-900">{suggestion.evidence.sample_size}</div>
                            <div className="text-xs text-gray-500">videos</div>
                          </div>
                          <div className="text-center p-3 bg-gray-50 rounded-xl">
                            <BarChart3 className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                            <div className="font-semibold text-gray-900">{Math.round(suggestion.evidence.confidence_score * 100)}%</div>
                            <div className="text-xs text-gray-500">confidence</div>
                          </div>
                          <div className="text-center p-3 bg-gray-50 rounded-xl">
                            <Sparkles className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                            <div className="font-semibold text-gray-900">{suggestion.pattern.name.split('_')[0]}</div>
                            <div className="text-xs text-gray-500">pattern</div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        {suggestion.pattern.video_ids && suggestion.pattern.video_ids.length > 0 && (
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedCard(null);
                              } else {
                                setExpandedCard(index);
                                if (!patternVideos[index]) {
                                  fetchPatternVideos(index, suggestion.pattern.video_ids!);
                                }
                              }
                            }}
                            className="w-full group/btn"
                          >
                            {isExpanded ? 'Hide Evidence' : 'View Evidence'}
                            <ArrowRight className={cn(
                              "ml-2 h-4 w-4 transition-transform group-hover/btn:translate-x-1",
                              isExpanded && "rotate-90"
                            )} />
                          </Button>
                        )}

                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className="mt-6 pt-6 border-t">
                            {loadingVideos[index] ? (
                              <div className="flex justify-center py-12">
                                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                              </div>
                            ) : patternVideos[index] && (
                              <div className="space-y-3">
                                <h4 className="font-medium text-gray-900 mb-4">Videos using this pattern</h4>
                                {patternVideos[index].map((video) => (
                                  <a
                                    key={video.id}
                                    href={`https://youtube.com/watch?v=${video.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-4 p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition-all hover:scale-[1.02] group/video"
                                  >
                                    {video.thumbnail_url && (
                                      <div className="relative flex-shrink-0 overflow-hidden rounded-lg">
                                        <img 
                                          src={video.thumbnail_url} 
                                          alt={video.title}
                                          className="w-32 h-20 object-cover"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover/video:bg-black/20 transition-colors flex items-center justify-center">
                                          <Play className="h-8 w-8 text-white opacity-0 group-hover/video:opacity-100 transition-opacity" />
                                        </div>
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-gray-900 truncate">
                                        {video.title}
                                      </div>
                                      <div className="text-sm text-gray-500">
                                        {video.channel_name} • {video.view_count.toLocaleString()} views
                                      </div>
                                    </div>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}