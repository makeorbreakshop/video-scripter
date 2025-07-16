'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, 
  Clock, 
  Hash, 
  Calendar,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Info,
  ExternalLink,
  PlayCircle
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Pattern {
  id: string;
  pattern_type: string;
  pattern_data: {
    name: string;
    template?: string;
    description?: string;
    discovery_method: string;
    evidence_count: number;
    confidence: number;
    performance_vs_baseline?: number;
    duration_range?: string;
    optimal_range?: string;
    day_of_week?: string;
    cluster?: string;
    format?: string;
    examples?: string[];
    topic_cluster_id?: string;
    dominant_formats?: Array<{
      format: string;
      count: number;
      avg_performance: number;
    }>;
    llm_analysis?: {
      is_meaningful: boolean;
      actionability_score: number;
      why_it_works: string;
      best_use_cases: string[];
      warnings?: string[];
      semantic_category: string;
      confidence: number;
    };
  };
  performance_stats: {
    overall?: {
      avg: number;
      median: number;
      count: number;
    };
    avg?: number;
    median?: number;
    count?: number;
    by_context?: Record<string, { avg: number; count: number }>;
    timeline?: Array<{ month: string; performance: number; adopters: number }>;
    saturation_score?: number;
  };
  created_at: string;
  updated_at: string;
  example_videos?: Array<{
    id: string;
    title: string;
    channel_name?: string;
    view_count: number;
    published_at: string;
    thumbnail_url?: string;
    match_score?: number;
  }>;
}

interface VideoExample {
  id: string;
  title: string;
  channel_title: string;
  view_count: number;
  performance_ratio?: number;
  published_at: string;
}

export default function PatternsPage() {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPatterns, setExpandedPatterns] = useState<Set<string>>(new Set());

  const fetchPatterns = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/youtube/patterns/list');
      const data = await response.json();
      
      if (data.success && data.patterns) {
        setPatterns(data.patterns);
      } else if (data.patterns) {
        // Fallback for different API response format
        setPatterns(data.patterns);
      }
    } catch (error) {
      console.error('Error fetching patterns:', error);
    } finally {
      setLoading(false);
    }
  };


  const togglePattern = (patternId: string) => {
    setExpandedPatterns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(patternId)) {
        newSet.delete(patternId);
      } else {
        newSet.add(patternId);
      }
      return newSet;
    });
  };

  const runDiscovery = async () => {
    try {
      setRefreshing(true);
      const response = await fetch('/api/youtube/patterns/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic_cluster: 127,
          min_performance: 1.5,
          min_confidence: 0.7,
          min_videos: 5
        })
      });
      
      const data = await response.json();
      console.log('Discovery complete:', data);
      
      await fetchPatterns();
    } catch (error) {
      console.error('Error running discovery:', error);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPatterns();
  }, []);

  // Sort patterns by performance
  const topPatterns = [...patterns]
    .sort((a, b) => {
      const aPerf = a.performance_stats.overall?.avg || a.performance_stats.avg || a.pattern_data.avg_performance || 0;
      const bPerf = b.performance_stats.overall?.avg || b.performance_stats.avg || b.pattern_data.avg_performance || 0;
      return bPerf - aPerf;
    })
    .filter(p => {
      const perf = p.performance_stats.overall?.avg || p.performance_stats.avg || p.pattern_data.avg_performance || 0;
      return perf > 1.5; // Only show patterns with meaningful performance
    });

  const formatPerformance = (value: number) => {
    return `${value.toFixed(1)}x`;
  };

  const formatViewCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
    return count.toString();
  };

  const getPatternContext = (pattern: Pattern) => {
    // Get context information about where this pattern works
    if (pattern.performance_stats.by_context && Object.keys(pattern.performance_stats.by_context).length > 0) {
      return Object.entries(pattern.performance_stats.by_context)
        .sort(([, a], [, b]) => b.avg - a.avg)
        .slice(0, 3)
        .map(([context, stats]) => ({
          name: context,
          performance: stats.avg,
          count: stats.count
        }));
    }
    
    if (pattern.pattern_data.topic_cluster_id) {
      return [{
        name: pattern.pattern_data.topic_cluster_id,
        performance: pattern.performance_stats.avg || pattern.pattern_data.avg_performance || 0,
        count: pattern.pattern_data.evidence_count
      }];
    }
    
    return [];
  };

  const getPatternDescription = (pattern: Pattern) => {
    // Use LLM analysis if available
    if (pattern.pattern_data.llm_analysis?.why_it_works) {
      return pattern.pattern_data.llm_analysis.why_it_works;
    }

    // Fallback to original descriptions
    switch (pattern.pattern_type) {
      case 'title':
        if (pattern.pattern_data.template) {
          return `Use this title structure: "${pattern.pattern_data.template}"`;
        }
        return `Include "${pattern.pattern_data.name.replace(' title pattern', '')}" in your titles`;
      
      case 'title_structure':
        return `Keep titles around ${pattern.pattern_data.name}`;
      
      case 'duration':
        return `Aim for ${pattern.pattern_data.optimal_range || pattern.pattern_data.duration_range} videos`;
      
      case 'timing':
        return `Publish on ${pattern.pattern_data.day_of_week || pattern.pattern_data.name.replace(' publishing advantage', '')}s for best results`;
      
      case 'format':
        return `The "${pattern.pattern_data.format}" format performs exceptionally well`;
      
      case 'topic_cluster':
        if (pattern.pattern_data.dominant_formats && pattern.pattern_data.dominant_formats.length > 0) {
          const topFormat = pattern.pattern_data.dominant_formats[0];
          return `In this topic, "${topFormat.format}" videos perform ${formatPerformance(topFormat.avg_performance)}`;
        }
        return 'Topic-specific insights for better performance';
      
      default:
        return pattern.pattern_data.description || 'Pattern discovered from high-performing videos';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Content Patterns That Actually Work</h1>
        <p className="text-muted-foreground">
          Data-driven insights from analyzing high-performing videos
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading patterns...
        </div>
      ) : patterns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">No patterns discovered yet</h3>
            <p className="text-muted-foreground mb-4">
              Click the button below to analyze high-performing videos
            </p>
            <Button 
              onClick={runDiscovery} 
              disabled={refreshing}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Discover Patterns
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Patterns with Evidence */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Proven Patterns</h2>
              <Button 
                onClick={runDiscovery} 
                disabled={refreshing}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            
            <div className="space-y-4">
              {topPatterns.map((pattern) => {
                const contexts = getPatternContext(pattern);
                const isExpanded = expandedPatterns.has(pattern.id);
                const videos = pattern.example_videos || [];
                const perf = pattern.performance_stats.overall?.avg || pattern.performance_stats.avg || pattern.pattern_data.avg_performance || 0;
                
                return (
                  <Card key={pattern.id} className="overflow-hidden">
                    <Collapsible open={isExpanded} onOpenChange={() => togglePattern(pattern.id)}>
                      <CollapsibleTrigger className="w-full">
                        <div className="p-6 hover:bg-muted/50 transition-colors">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 space-y-3 text-left">
                              {/* Performance and Evidence */}
                              <div className="flex items-center gap-3 flex-wrap">
                                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                                  {formatPerformance(perf)} better than average
                                </Badge>
                                <Badge variant="outline">
                                  Based on {pattern.pattern_data.evidence_count} videos
                                </Badge>
                                {pattern.pattern_data.confidence >= 0.9 && (
                                  <Badge variant="secondary">
                                    High confidence
                                  </Badge>
                                )}
                              </div>
                              
                              {/* Pattern Name and Description */}
                              <div>
                                <h3 className="text-xl font-semibold capitalize">
                                  {pattern.pattern_data.name}
                                </h3>
                                <p className="text-muted-foreground mt-1">
                                  {getPatternDescription(pattern)}
                                </p>
                              </div>
                              
                              {/* Where it works */}
                              {contexts.length > 0 && (
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="text-muted-foreground">Works best in:</span>
                                  {contexts.map((ctx, i) => (
                                    <Badge key={i} variant="secondary" className="font-normal">
                                      {ctx.name} ({formatPerformance(ctx.performance)})
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              
                              {/* Example for title patterns */}
                              {pattern.pattern_type === 'title' && pattern.pattern_data.examples && pattern.pattern_data.examples[0] && (
                                <div className="bg-muted/50 rounded-lg p-3 text-sm">
                                  <span className="text-muted-foreground">Example: </span>
                                  <span className="font-medium">"{pattern.pattern_data.examples[0]}"</span>
                                </div>
                              )}
                            </div>
                            
                            <div className="ml-4 flex items-center">
                              {isExpanded ? (
                                <ChevronDown className="h-5 w-5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-5 w-5 text-muted-foreground" />
                              )}
                            </div>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      
                      <CollapsibleContent>
                        <div className="border-t px-6 py-4 bg-muted/20">
                          <div className="space-y-4">
                            <h4 className="font-medium flex items-center gap-2">
                              <PlayCircle className="h-4 w-4" />
                              Top Videos Using This Pattern
                            </h4>
                            
                            {videos.length > 0 ? (
                              <div className="space-y-3">
                                {videos.slice(0, 5).map((video) => (
                                  <div key={video.id} className="flex items-start justify-between gap-4 p-3 bg-background rounded-lg">
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium text-sm truncate">{video.title}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {video.channel_name || 'Unknown Channel'} • {formatViewCount(video.view_count)} views
                                        {video.match_score && (
                                          <span className="text-blue-500"> • {(video.match_score * 100).toFixed(0)}% match</span>
                                        )}
                                      </p>
                                    </div>
                                    <a
                                      href={`https://youtube.com/watch?v=${video.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-foreground"
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </a>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">No video examples available</p>
                            )}
                            
                            {/* LLM Insights */}
                            {pattern.pattern_data.llm_analysis && (
                              <div className="mt-4 pt-4 border-t space-y-3">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-blue-500" />
                                  <h4 className="font-medium text-sm">AI Analysis</h4>
                                  <Badge variant="secondary" className="text-xs">
                                    Actionability: {pattern.pattern_data.llm_analysis.actionability_score}/10
                                  </Badge>
                                </div>
                                
                                {/* Best use cases */}
                                {pattern.pattern_data.llm_analysis.best_use_cases.length > 0 && (
                                  <div>
                                    <p className="text-sm font-medium mb-1">Best for:</p>
                                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                      {pattern.pattern_data.llm_analysis.best_use_cases.map((useCase, i) => (
                                        <li key={i}>{useCase}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
                                {/* Warnings */}
                                {pattern.pattern_data.llm_analysis.warnings && pattern.pattern_data.llm_analysis.warnings.length > 0 && (
                                  <div className="bg-yellow-500/10 text-yellow-700 dark:text-yellow-300 rounded-lg p-3">
                                    <p className="text-sm font-medium mb-1 flex items-center gap-1">
                                      <Info className="h-3 w-3" />
                                      Caution:
                                    </p>
                                    <ul className="list-disc list-inside text-sm space-y-1">
                                      {pattern.pattern_data.llm_analysis.warnings.map((warning, i) => (
                                        <li key={i}>{warning}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Additional insights */}
                            {pattern.pattern_data.dominant_formats && pattern.pattern_data.dominant_formats.length > 0 && (
                              <div className="mt-4 pt-4 border-t">
                                <h4 className="font-medium text-sm mb-2">Format Breakdown</h4>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                  {pattern.pattern_data.dominant_formats.map((format, i) => (
                                    <div key={i} className="bg-muted/50 rounded-lg p-2 text-sm">
                                      <p className="font-medium capitalize">{format.format.replace('_', ' ')}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {format.count} videos • {formatPerformance(format.avg_performance)}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid md:grid-cols-3 gap-4 pt-8">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Videos Analyzed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {patterns.reduce((sum, p) => sum + p.pattern_data.evidence_count, 0).toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Patterns Found</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{patterns.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Avg Performance Gain</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {patterns.length > 0 
                    ? formatPerformance(
                        patterns.reduce((sum, p) => {
                          const perf = p.performance_stats.overall?.avg || p.performance_stats.avg || p.pattern_data.avg_performance || 0;
                          return sum + perf;
                        }, 0) / patterns.length
                      )
                    : '0x'
                  }
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}