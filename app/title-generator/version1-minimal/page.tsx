'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Loader2,
  Sparkles,
  TrendingUp,
  Users,
  BarChart3,
  Copy,
  Check,
  ChevronRight,
  Play
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

export default function TitleGeneratorV1() {
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
      console.log('Submitting concept:', concept);
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

      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Failed to generate titles: ${response.status}`);
      }

      const data: TitleGenerationResponse = await response.json();
      console.log('Response data:', data);
      setResults(data);
    } catch (err) {
      console.error('Error in handleSubmit:', err);
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

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-medium text-gray-900 mb-4">
            Title Generator
          </h1>
          <p className="text-xl text-gray-500">
            AI-powered title suggestions based on 100K+ successful videos
          </p>
        </div>

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="mb-16">
          <div className="relative max-w-2xl mx-auto">
            <Input
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Describe your video concept..."
              className="w-full h-16 pl-6 pr-32 text-lg text-gray-900 bg-white border-gray-200 rounded-full focus:border-gray-300 focus:ring-0 placeholder:text-gray-400"
            />
            <Button 
              type="submit" 
              disabled={!concept.trim() || isLoading}
              className="absolute right-2 top-2 h-12 px-8 bg-black hover:bg-gray-800 text-white rounded-full"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                'Generate'
              )}
            </Button>
          </div>
          
          {/* Popular searches */}
          <div className="flex flex-wrap gap-2 justify-center mt-6">
            {['productivity tips', 'cooking basics', 'guitar lessons', 'travel hacks'].map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setConcept(tag)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-full transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 text-red-600 rounded-lg text-center">
            {error}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="flex justify-center gap-8 text-center mb-12">
              <div>
                <div className="text-3xl font-medium text-gray-900">{results.suggestions.length}</div>
                <div className="text-sm text-gray-500">Titles Generated</div>
              </div>
              <div className="w-px bg-gray-200" />
              <div>
                <div className="text-3xl font-medium text-gray-900">{results.total_patterns_searched}</div>
                <div className="text-sm text-gray-500">Patterns Analyzed</div>
              </div>
              <div className="w-px bg-gray-200" />
              <div>
                <div className="text-3xl font-medium text-gray-900">{(results.processing_time_ms / 1000).toFixed(1)}s</div>
                <div className="text-sm text-gray-500">Processing Time</div>
              </div>
            </div>

            {/* Title Suggestions */}
            <div className="space-y-4">
              {results.suggestions.map((suggestion, index) => {
                const isExpanded = expandedPattern === index;
                
                return (
                  <div key={index} className="group">
                    <div className="p-6 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
                      {/* Title */}
                      <div className="flex items-start justify-between mb-4">
                        <h3 className="text-xl font-medium text-gray-900 flex-1 mr-4">
                          {suggestion.title}
                        </h3>
                        <button
                          onClick={() => copyToClipboard(suggestion.title, index)}
                          className="p-2 hover:bg-white rounded-lg transition-colors"
                        >
                          {copiedIndex === index ? (
                            <Check className="h-5 w-5 text-green-600" />
                          ) : (
                            <Copy className="h-5 w-5 text-gray-400" />
                          )}
                        </button>
                      </div>

                      {/* Metrics */}
                      <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-gray-400" />
                          <span className="font-medium text-gray-900">{suggestion.pattern.performance_lift.toFixed(1)}x</span>
                          <span className="text-gray-500">performance</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-gray-400" />
                          <span className="font-medium text-gray-900">{suggestion.evidence.sample_size}</span>
                          <span className="text-gray-500">videos</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4 text-gray-400" />
                          <span className="font-medium text-gray-900">{Math.round(suggestion.evidence.confidence_score * 100)}%</span>
                          <span className="text-gray-500">confidence</span>
                        </div>
                      </div>

                      {/* Expand Button */}
                      {suggestion.pattern.video_ids && suggestion.pattern.video_ids.length > 0 && (
                        <button
                          onClick={() => togglePatternExpansion(index)}
                          className="mt-4 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                        >
                          <span>View evidence</span>
                          <ChevronRight className={cn(
                            "h-4 w-4 transition-transform",
                            isExpanded && "rotate-90"
                          )} />
                        </button>
                      )}
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="mt-2 p-6 bg-white border border-gray-200 rounded-lg">
                        <p className="text-gray-600 mb-6">{suggestion.explanation}</p>
                        
                        {loadingVideos[index] ? (
                          <div className="flex justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                          </div>
                        ) : patternVideos[index] && (
                          <div className="space-y-3">
                            {patternVideos[index].map((video) => (
                              <a 
                                key={video.id}
                                href={`https://youtube.com/watch?v=${video.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-4 p-3 hover:bg-gray-50 rounded-lg transition-colors"
                              >
                                {video.thumbnail_url && (
                                  <img 
                                    src={video.thumbnail_url} 
                                    alt={video.title}
                                    className="w-24 h-14 object-cover rounded"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 truncate">{video.title}</div>
                                  <div className="text-sm text-gray-500">{video.channel_name} • {video.view_count.toLocaleString()} views</div>
                                </div>
                                <Play className="h-5 w-5 text-gray-400" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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