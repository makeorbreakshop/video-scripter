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
  Target,
  Palette,
  Layout,
  Layers
} from 'lucide-react';
import Link from 'next/link';
import { DebugPanel } from '@/components/debug-panel';
import { SearchProgress } from '@/components/search-progress';
import { SearchStats } from '@/components/search-stats';
import { ResultsShimmer } from '@/components/results-shimmer';

interface TitleSuggestion {
  title: string;
  pattern: {
    id: string;
    name: string;
    template?: string;
    performance_lift: number;
    examples: string[];
    video_ids?: string[];
    source_thread?: string;
    thread_purpose?: string;
    // Pool-and-cluster additions
    found_by_threads?: string[];
    thread_count?: number;
    pattern_type?: 'WIDE' | 'DEEP';
    cluster_info?: {
      cluster_id: string;
      cluster_size: number;
      thread_overlap: number;
    };
    verification?: {
      matchCount: number;
      medianPerformance: number;
      avgPerformance: number;
      topPerformers: number;
      verificationScore: number;
    };
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
  debug?: {
    embeddingLength: number;
    searchThreshold: number;
    totalVideosFound: number;
    scoreDistribution: Record<string, number>;
    topVideos: Array<{
      id: string;
      title: string;
      score: number;
      channel: string;
    }>;
    claudePrompt?: string;
    claudePatterns?: any[];
    processingSteps: Array<{
      step: string;
      duration_ms: number;
      details?: any;
    }>;
  };
}

interface Video {
  id: string;
  title: string;
  channel_name: string;
  view_count: number;
  published_at: string;
  thumbnail_url: string;
}

export default function TitleGeneratorPage() {
  const [concept, setConcept] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<TitleGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [loadingVideos, setLoadingVideos] = useState<Record<number, boolean>>({});
  const [patternVideos, setPatternVideos] = useState<Record<number, Video[]>>({});
  const [expandedPattern, setExpandedPattern] = useState<number | null>(null);
  
  // Stats for real-time display
  const [searchStats, setSearchStats] = useState({
    videosFound: 0,
    patternsFound: 0,
    topPerformance: 1,
    channelsRepresented: 0
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;

    setIsLoading(true);
    setError(null);
    setResults(null);
    
    // Clear all cached state
    setCopiedIndex(null);
    setLoadingVideos({});
    setPatternVideos({});
    setExpandedPattern(null);
    
    // Reset stats for new search
    setSearchStats({
      videosFound: 0,
      patternsFound: 0,
      topPerformance: 1,
      channelsRepresented: 0
    });

    try {
      const response = await fetch('/api/youtube/patterns/generate-titles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store', // Disable caching
        body: JSON.stringify({
          concept: concept.trim(),
          options: {
            maxSuggestions: 8,
            includeExamples: true,
            timestamp: Date.now() // Cache buster
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate titles');
      }

      const data: TitleGenerationResponse = await response.json();
      
      // Check if the response contains an error
      if ('error' in data && data.error) {
        setError(data.error as string);
      } else {
        setResults(data);
        
        // Update search stats from the response
        if (data.debug) {
          const uniqueChannels = new Set(
            data.debug.allVideosWithDetails?.map((v: any) => v.channelName) || []
          ).size;
          
          const topPerf = Math.max(
            ...(data.debug.allVideosWithDetails?.map((v: any) => v.performanceRatio || 1) || [1])
          );
          
          setSearchStats({
            videosFound: data.debug.totalVideosFound || 0,
            patternsFound: data.suggestions.length || 0,
            topPerformance: topPerf,
            channelsRepresented: uniqueChannels
          });
        }
      }
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
    if (lift >= 20) return { label: 'Exceptional', color: 'bg-green-600 text-white' };
    if (lift >= 10) return { label: 'Strong', color: 'bg-blue-600 text-white' };
    if (lift >= 5) return { label: 'Good', color: 'bg-gray-600 text-white' };
    return { label: 'Moderate', color: 'bg-gray-500 text-white' };
  };

  const getConfidenceIcon = (score: number) => {
    if (score >= 0.8) return '🟢';
    if (score >= 0.6) return '🟡';
    return '🔴';
  };

  const getPatternTypeInfo = (pattern: TitleSuggestion['pattern']) => {
    const threadCount = pattern.thread_count || pattern.found_by_threads?.length || 1;
    const patternType = pattern.pattern_type || (threadCount >= 3 ? 'WIDE' : 'DEEP');
    
    if (patternType === 'WIDE') {
      return {
        label: 'WIDE',
        icon: '🌐',
        description: `Found by ${threadCount} threads`,
        color: 'bg-purple-600 text-white',
        strength: 'Cross-thread validated'
      };
    } else {
      return {
        label: 'DEEP',
        icon: '🎯',
        description: `Found by ${threadCount} thread${threadCount > 1 ? 's' : ''}`,
        color: 'bg-blue-600 text-white',
        strength: 'Thread-specific'
      };
    }
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Hero Section - Compact */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="container mx-auto px-4 py-8 max-w-5xl">
          <div className="text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-100">
                AI-Powered Title Generator
              </h1>
            </div>
            <p className="text-sm text-gray-400 max-w-2xl mx-auto mb-6">
              Generate high-performing YouTube titles based on patterns from 100K+ successful videos
            </p>
            
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Input Section - Simplified */}
        <Card className="mb-6 border border-gray-700 bg-gray-800/50">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="concept" className="text-sm font-medium mb-2 block text-gray-300">
                  What's your video about?
                </Label>
                <div className="relative">
                  <Input
                    id="concept"
                    value={concept}
                    onChange={(e) => setConcept(e.target.value)}
                    placeholder="e.g., beginner woodworking mistakes"
                    className="h-12 text-base pr-28 bg-gray-700 border-gray-600 text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:ring-blue-500"
                  />
                  <Button 
                    type="submit" 
                    disabled={!concept.trim() || isLoading}
                    className="absolute right-1.5 top-1.5 h-9 px-4 text-sm"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Generate
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">Try these:</span>
                <div className="flex flex-wrap gap-1.5">
                  {exampleConcepts.map((example) => (
                    <Button
                      key={example.text}
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setConcept(example.text)}
                      className="h-7 px-3 text-xs rounded-full hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                    >
                      <span className="mr-1 text-[10px]">{example.icon}</span>
                      {example.text}
                    </Button>
                  ))}
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Progress Indicator */}
        <SearchProgress 
          isActive={isLoading}
          concept={concept}
        />


        {/* Results Shimmer */}
        {isLoading && (
          <div className="max-w-4xl mx-auto">
            <ResultsShimmer />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-800 rounded-xl text-red-400">
            <p className="font-medium">Error: {error}</p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-6">
            {/* Results Summary - Simplified */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-100">
                  Results for "{results.concept}"
                </h2>
                <p className="text-sm text-gray-400 mt-1">
                  {results.suggestions.length} patterns • {results.total_patterns_searched} analyzed • {results.processing_time_ms}ms
                </p>
              </div>
            </div>

            {/* Title Suggestions - Compact Design */}
            <div className="space-y-2">
              {results.suggestions.map((suggestion, index) => {
                const performanceLevel = getPerformanceLevel(suggestion.pattern.performance_lift);
                const patternTypeInfo = getPatternTypeInfo(suggestion.pattern);
                const isExpanded = expandedPattern === index;
                
                return (
                  <Card 
                    key={index} 
                    className="border border-gray-700 bg-gray-800/50 hover:bg-gray-800 transition-all cursor-pointer"
                    onClick={() => togglePatternExpansion(index)}
                  >
                    <CardContent className="p-4">
                      {/* Compact Single Row Layout */}
                      <div className="flex items-center justify-between">
                        {/* Left: Title and Pattern */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            {/* Performance Badge */}
                            <Badge className={`${performanceLevel.color} text-xs font-bold min-w-[60px] justify-center`}>
                              {suggestion.pattern.performance_lift.toFixed(1)}x
                            </Badge>
                            
                            {/* Pattern Type Badge */}
                            <Badge className={`${patternTypeInfo.color} text-xs font-bold min-w-[50px] justify-center`} title={patternTypeInfo.strength}>
                              {patternTypeInfo.icon} {patternTypeInfo.label}
                            </Badge>
                            
                            {/* Title Template */}
                            <h3 className="font-mono text-sm text-gray-100 truncate flex-1">
                              {suggestion.title}
                            </h3>
                          </div>
                          
                          {/* Pattern Name and Explanation - Single Line */}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">{suggestion.pattern.name}</span>
                            {suggestion.pattern.source_thread && (
                              <>
                                <span className="text-xs text-gray-600">•</span>
                                <span className="text-xs text-blue-400">{suggestion.pattern.source_thread}</span>
                              </>
                            )}
                            <span className="text-xs text-gray-600">•</span>
                            <span className="text-xs text-gray-400 truncate">{suggestion.explanation}</span>
                            {patternTypeInfo.description && (
                              <>
                                <span className="text-xs text-gray-600">•</span>
                                <span className="text-xs text-purple-400">{patternTypeInfo.description}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Right: Compact Metrics and Actions */}
                        <div className="flex items-center gap-4 ml-4">
                          {/* Inline Metrics */}
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            <div className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              <span>{suggestion.evidence.sample_size}</span>
                            </div>
                            {suggestion.pattern.verification && (
                              <div className="flex items-center gap-1 text-green-400">
                                <Check className="h-3 w-3" />
                                <span>{suggestion.pattern.verification.medianPerformance.toFixed(1)}x</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              {getConfidenceIcon(suggestion.evidence.confidence_score)}
                              <span>{Math.round(suggestion.evidence.confidence_score * 100)}%</span>
                            </div>
                          </div>
                          
                          {/* Copy Button */}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(suggestion.title, index);
                            }}
                            className="h-8 w-8"
                          >
                            {copiedIndex === index ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4 text-gray-400" />
                            )}
                          </Button>
                          
                          {/* Expand Indicator */}
                          {suggestion.pattern.video_ids && suggestion.pattern.video_ids.length > 0 && (
                            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          )}
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-gray-700">
                          {/* Verification Stats */}
                          {suggestion.pattern.verification && (
                            <div className="mb-3 p-3 bg-gray-700/50 rounded">
                              <h4 className="text-xs font-medium text-gray-300 mb-2">✅ Pattern Verified</h4>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-gray-400">Similar titles found:</span>
                                  <span className="ml-2 text-gray-200 font-medium">{suggestion.pattern.verification.matchCount}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Median performance:</span>
                                  <span className="ml-2 text-green-400 font-medium">{suggestion.pattern.verification.medianPerformance.toFixed(1)}x</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Top performers (10x+):</span>
                                  <span className="ml-2 text-purple-400 font-medium">{suggestion.pattern.verification.topPerformers}</span>
                                </div>
                                <div>
                                  <span className="text-gray-400">Verification score:</span>
                                  <span className="ml-2 text-gray-200 font-medium">{Math.round(suggestion.pattern.verification.verificationScore * 100)}%</span>
                                </div>
                              </div>
                            </div>
                          )}
                          
                          {/* Thread Attribution and Pool-Cluster Info */}
                          {suggestion.pattern.thread_purpose && (
                            <div className="mb-3 text-xs">
                              <span className="text-gray-400">Pattern Source: </span>
                              <span className="text-blue-400">{suggestion.pattern.thread_purpose}</span>
                            </div>
                          )}
                          
                          {/* Pool-and-Cluster Information */}
                          {suggestion.pattern.found_by_threads && suggestion.pattern.found_by_threads.length > 0 && (
                            <div className="mb-3 p-3 bg-gray-700/50 rounded">
                              <h4 className="text-xs font-medium text-gray-300 mb-2">
                                🔍 Thread Provenance ({patternTypeInfo.label} Pattern)
                              </h4>
                              <div className="space-y-1">
                                <div className="text-xs text-gray-400">
                                  Found by {suggestion.pattern.found_by_threads.length} thread{suggestion.pattern.found_by_threads.length > 1 ? 's' : ''}:
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {suggestion.pattern.found_by_threads.map((thread, i) => (
                                    <Badge key={i} variant="outline" className="text-xs bg-blue-900/30 text-blue-300">
                                      {thread}
                                    </Badge>
                                  ))}
                                </div>
                                {suggestion.pattern.cluster_info && (
                                  <div className="text-xs text-purple-400 mt-1">
                                    Cluster #{suggestion.pattern.cluster_info.cluster_id} 
                                    ({suggestion.pattern.cluster_info.cluster_size} videos, 
                                    {suggestion.pattern.cluster_info.thread_overlap} thread overlap)
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {/* Examples */}
                          {suggestion.pattern.examples.length > 0 && (
                            <div className="mb-3">
                              <h4 className="text-xs font-medium text-gray-400 mb-2">Example Titles:</h4>
                              <div className="space-y-1">
                                {suggestion.pattern.examples.map((example, i) => (
                                  <div key={i} className="text-xs text-gray-300 flex items-start">
                                    <span className="text-blue-400 mr-2">•</span>
                                    <span className="font-mono">{example}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Videos */}
                          {loadingVideos[index] ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                            </div>
                          ) : patternVideos[index] ? (
                            <div>
                              <h4 className="text-xs font-medium text-gray-400 mb-2">Videos Using This Pattern:</h4>
                              <div className="space-y-2">
                                {patternVideos[index].map((video) => (
                                  <div key={video.id} className="flex items-center gap-3 p-2 bg-gray-750 rounded hover:bg-gray-700 transition-colors">
                                    {video.thumbnail_url && (
                                      <img 
                                        src={video.thumbnail_url} 
                                        alt={video.title}
                                        className="w-24 h-14 object-cover rounded flex-shrink-0"
                                      />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <h5 className="text-xs text-gray-200 truncate">
                                        {video.title}
                                      </h5>
                                      <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                        <span>{video.channel_name}</span>
                                        <span>•</span>
                                        <span>{video.view_count.toLocaleString()} views</span>
                                        {video.performance_ratio && (
                                          <>
                                            <span>•</span>
                                            <span className="text-green-400">{video.performance_ratio.toFixed(1)}x</span>
                                          </>
                                        )}
                                        {video.published_at && (
                                          <>
                                            <span>•</span>
                                            <span>{new Date(video.published_at).toLocaleDateString()}</span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    <a 
                                      href={`https://youtube.com/watch?v=${video.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex-shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <ExternalLink className="h-3 w-3 text-gray-500 hover:text-gray-300" />
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
              <Card className="border border-gray-700 bg-gray-800/50">
                <CardContent className="py-8 text-center">
                  <Target className="h-8 w-8 text-gray-600 mx-auto mb-3" />
                  <h3 className="text-base font-medium text-gray-300 mb-1">No patterns found</h3>
                  <p className="text-sm text-gray-500 max-w-md mx-auto">
                    Try a different topic or check your database.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
      
      {/* Debug Panel */}
      <DebugPanel debug={results?.debug} concept={concept} />
    </div>
  );
}