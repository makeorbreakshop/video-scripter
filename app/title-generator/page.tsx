'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Loader2, 
  Sparkles, 
  TrendingUp, 
  ChevronDown,
  ChevronUp,
  Video,
  ExternalLink,
  AlertCircle
} from 'lucide-react';

interface Video {
  id: string;
  title: string;
  channel_name: string;
  view_count: number;
  thumbnail_url?: string;
  performance_ratio?: number;
}

interface Pattern {
  id: string;
  name: string;
  template?: string;
  performance_lift: number;
  examples: string[];
  video_ids?: string[];
  source_thread?: string;
  thread_purpose?: string;
}

interface PatternResult {
  title: string;
  pattern: Pattern;
  evidence: {
    sample_size: number;
    avg_performance: number;
    confidence_score: number;
  };
  explanation: string;
  similarity_score: number;
}

export default function TitleGeneratorPage() {
  const [concept, setConcept] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patterns, setPatterns] = useState<PatternResult[]>([]);
  const [expandedPatterns, setExpandedPatterns] = useState<Set<number>>(new Set());
  const [patternVideos, setPatternVideos] = useState<Record<number, Video[]>>({});
  const [loadingVideos, setLoadingVideos] = useState<Record<number, boolean>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;

    setLoading(true);
    setError(null);
    setPatterns([]);
    setExpandedPatterns(new Set());
    setPatternVideos({});

    try {
      const response = await fetch('/api/youtube/patterns/generate-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept: concept.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate patterns');
      }

      if (data.suggestions && Array.isArray(data.suggestions)) {
        setPatterns(data.suggestions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const togglePattern = async (index: number) => {
    const newExpanded = new Set(expandedPatterns);
    
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
      
      // Load videos if not already loaded
      if (!patternVideos[index] && patterns[index]?.pattern?.video_ids?.length) {
        setLoadingVideos(prev => ({ ...prev, [index]: true }));
        
        try {
          const response = await fetch('/api/youtube/videos/by-ids', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              videoIds: patterns[index].pattern.video_ids.slice(0, 5) 
            }),
          });
          
          if (response.ok) {
            const data = await response.json();
            setPatternVideos(prev => ({ ...prev, [index]: data.videos || [] }));
          }
        } catch (err) {
          console.error('Failed to load videos:', err);
        } finally {
          setLoadingVideos(prev => ({ ...prev, [index]: false }));
        }
      }
    }
    
    setExpandedPatterns(newExpanded);
  };

  const getPerformanceColor = (lift: number) => {
    if (lift >= 10) return 'text-green-600 bg-green-50 border-green-200';
    if (lift >= 5) return 'text-blue-600 bg-blue-50 border-blue-200';
    if (lift >= 2) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Title Pattern Generator</h1>
        <p className="text-muted-foreground">
          Discover high-performing title patterns from successful YouTube videos
        </p>
      </div>

      {/* Input Form */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Title Patterns</CardTitle>
          <CardDescription>
            Enter your video concept to find proven title patterns
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="concept">Video Concept</Label>
              <div className="flex gap-2">
                <Input
                  id="concept"
                  placeholder="e.g., how to build a table, beginner woodworking"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  disabled={loading}
                  className="flex-1"
                />
                <Button type="submit" disabled={loading || !concept.trim()}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Patterns
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {patterns.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Discovered Patterns ({patterns.length})
            </h2>
          </div>

          {patterns.map((result, index) => {
            const isExpanded = expandedPatterns.has(index);
            const performanceColor = getPerformanceColor(result.pattern.performance_lift);

            return (
              <Card key={index}>
                <CardContent className="p-6">
                  {/* Pattern Header */}
                  <div 
                    className="flex items-start justify-between cursor-pointer"
                    onClick={() => togglePattern(index)}
                  >
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={performanceColor}>
                          <TrendingUp className="mr-1 h-3 w-3" />
                          {result.pattern.performance_lift.toFixed(1)}x Performance
                        </Badge>
                        <Badge variant="secondary">
                          <Video className="mr-1 h-3 w-3" />
                          {result.evidence.sample_size} Videos
                        </Badge>
                        <Badge variant="outline">
                          {Math.round(result.evidence.confidence_score * 100)}% Confidence
                        </Badge>
                      </div>
                      
                      <h3 className="text-lg font-semibold">
                        {result.pattern.template || result.title}
                      </h3>
                      
                      <p className="text-sm text-muted-foreground">
                        {result.explanation}
                      </p>

                      {result.pattern.source_thread && (
                        <p className="text-sm text-muted-foreground">
                          Found in: {result.pattern.source_thread}
                        </p>
                      )}
                    </div>
                    
                    <Button variant="ghost" size="icon">
                      {isExpanded ? <ChevronUp /> : <ChevronDown />}
                    </Button>
                  </div>

                  {/* Expanded Content */}
                  {isExpanded && (
                    <div className="mt-6 space-y-4 border-t pt-4">
                      {/* Examples */}
                      <div>
                        <h4 className="font-medium mb-2">Example Titles</h4>
                        <ul className="space-y-1">
                          {result.pattern.examples.slice(0, 5).map((example, i) => (
                            <li key={i} className="text-sm text-muted-foreground">
                              • {example}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Videos */}
                      {result.pattern.video_ids && result.pattern.video_ids.length > 0 && (
                        <div>
                          <h4 className="font-medium mb-2">Top Performing Videos</h4>
                          
                          {loadingVideos[index] ? (
                            <div className="space-y-2">
                              {[...Array(3)].map((_, i) => (
                                <Skeleton key={i} className="h-20 w-full" />
                              ))}
                            </div>
                          ) : patternVideos[index] ? (
                            <div className="space-y-2">
                              {patternVideos[index].map((video) => (
                                <div key={video.id} className="flex items-center gap-3 p-2 rounded-lg border">
                                  {video.thumbnail_url && (
                                    <img 
                                      src={video.thumbnail_url} 
                                      alt={video.title}
                                      className="w-32 h-20 object-cover rounded"
                                    />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <h5 className="font-medium text-sm truncate">
                                      {video.title}
                                    </h5>
                                    <p className="text-xs text-muted-foreground">
                                      {video.channel_name} • {video.view_count.toLocaleString()} views
                                      {video.performance_ratio && (
                                        <span className="text-green-600">
                                          {' '}• {video.performance_ratio.toFixed(1)}x
                                        </span>
                                      )}
                                    </p>
                                  </div>
                                  <a
                                    href={`https://youtube.com/watch?v=${video.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-muted-foreground hover:text-primary"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Click to load videos
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}