'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Download, Copy, X, ChevronDown, Loader2, Heart, Settings, TrendingUp, ChevronRight, Calendar } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDebounce } from "use-debounce";
import { toast } from "@/components/ui/use-toast";
import { format } from "date-fns";
import { UnifiedVideoCard } from "@/components/youtube/unified-video-card";

interface Video {
  id: string;
  title: string;
  channel_id?: string;
  channel_name: string;
  thumbnail_url: string;
  view_count: number;
  published_at: string;
  format_type: string;
  performance_ratio: number;
  similarity?: number;
  channel_avg_views?: number;
  baseline_views?: number;
}

interface SearchState {
  // Search
  query: string;
  format: string | null;
  
  // Global Filters
  minViews: number | null;
  maxViews: number | null;
  minSubs: number | null;
  maxSubs: number | null;
  dateFilter: string;
  customStartDate: Date | null;
  customEndDate: Date | null;
}

const FORMAT_TYPES = [
  { value: 'all', label: 'All Formats' },
  { value: 'review', label: 'Review' },
  { value: 'tutorial', label: 'Tutorial' },
  { value: 'comparison', label: 'Comparison' },
  { value: 'list', label: 'List/Tips' },
  { value: 'explainer', label: 'Explainer' },
  { value: 'case_study', label: 'Case Study' },
  { value: 'product_focus', label: 'Product Focus' },
  { value: 'personal_story', label: 'Personal Story' },
  { value: 'live_stream', label: 'Live Stream' },
  { value: 'shorts', label: 'Shorts' },
  { value: 'vlog', label: 'Vlog' },
  { value: 'compilation', label: 'Compilation' },
  { value: 'update', label: 'Update' }
];

const DATE_FILTERS = [
  { value: 'all', label: 'All Time' },
  { value: '1week', label: 'Past Week' },
  { value: '1month', label: 'Past Month' },
  { value: '3months', label: 'Past 3 Months' },
  { value: '6months', label: 'Past 6 Months' },
  { value: '1year', label: 'Past Year' },
  { value: 'custom', label: 'Custom Range' }
];


interface GroupedResults {
  [categoryKey: string]: {
    videos: Video[];
    category_name: string;
    emoji: string;
  };
}

interface StrategyInfo {
  strategy: string;
  query: string;
  results_count: number;
  description: string;
}

// Helper function to format numbers
const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
};

// Helper function to get display text for range
const getRangeText = (min: number | null, max: number | null, type: 'views' | 'subs'): string => {
  const defaultText = type === 'views' ? 'All Views' : 'All Subscribers';
  
  // Handle edge cases
  if (!min && !max) return defaultText;
  if (min === 0 && max === 10000000) return defaultText;
  if (min === 0 && !max) return defaultText;
  if (!min && max === 10000000) return defaultText;
  
  // Handle valid ranges
  if (min && max && min < max) return `${formatNumber(min)} - ${formatNumber(max)}`;
  if (min && !max) return `${formatNumber(min)}+`;
  if (!min && max) return `Up to ${formatNumber(max)}`;
  if (min === max) return `${formatNumber(min)}`;
  
  return defaultText;
};

export default function PatternAnalysisPage() {
  const [searchState, setSearchState] = useState<SearchState>({
    query: '',
    format: null,
    minViews: null,
    maxViews: null,
    minSubs: null,
    maxSubs: null,
    dateFilter: 'all',
    customStartDate: null,
    customEndDate: null
  });
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);
  const [debouncedQuery] = useDebounce(searchState.query, 800);
  const [results, setResults] = useState<Video[]>([]);
  const [groupedResults, setGroupedResults] = useState<GroupedResults>({});
  const [strategiesUsed, setStrategiesUsed] = useState<StrategyInfo[]>([]);
  const [expandedStrategies, setExpandedStrategies] = useState<Set<string>>(new Set(['🎯 Keyword Matches', 'keyword'])); // Expand keyword categories by default
  const [selectedVideos, setSelectedVideos] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false); // AI enhancement state
  const [isExporting, setIsExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const currentSearchRef = useRef<string>(''); // Track current search to prevent stale results

  // Search effect - only trigger on query change
  useEffect(() => {
    if (debouncedQuery.length > 2) {
      performSearch(true);
    } else {
      setResults([]);
      setGroupedResults({});
      setStrategiesUsed([]);
      setPage(1);
      setHasMore(true);
    }
  }, [debouncedQuery]);

  // Separate effect for filter changes (don't retrigger if just starting)
  useEffect(() => {
    if (debouncedQuery.length > 2 && results.length > 0) {
      performSearch(true);
    }
  }, [searchState.format, searchState.minViews, searchState.maxViews, searchState.minSubs, searchState.maxSubs, searchState.dateFilter, searchState.customStartDate, searchState.customEndDate]);

  // Infinite scroll setup
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isSearching) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, isLoadingMore, isSearching]);

  const performSearch = async (newSearch = false) => {
    if (newSearch) {
      setIsSearching(true);
      setPage(1);
      setResults([]);
      setGroupedResults({});
      setStrategiesUsed([]);
      // Set current search ID to prevent stale results
      currentSearchRef.current = debouncedQuery;
    } else {
      setIsLoadingMore(true);
    }

    try {
      // Start with fast mode for immediate results
      if (newSearch) {
        console.log('⚡ Starting fast search...');
        const fastResponse = await fetch('/api/youtube/intelligent-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: debouncedQuery,
            page: 1,
            limit: 20,
            fastMode: true,
            filters: {
              format: searchState.format === 'all' ? null : searchState.format,
              minViews: searchState.minViews,
              maxViews: searchState.maxViews,
              dateFilter: searchState.dateFilter,
              customStartDate: searchState.customStartDate,
              customEndDate: searchState.customEndDate
            }
          })
        });

        const fastData = await fastResponse.json();
        
        if (fastResponse.ok) {
          console.log('⚡ Fast results loaded:', fastData.results?.length || 0);
          const videos = (fastData.results || []).map((video: any) => ({
            id: video.id,
            title: video.title,
            channel_id: video.channel_id,
            channel_name: video.channel_name || 'Unknown Channel',
            thumbnail_url: video.thumbnail_url,
            view_count: video.view_count,
            published_at: video.published_at,
            format_type: video.format_type || 'unknown',
            performance_ratio: video.performance_ratio || 0,
            similarity: video.similarity,
            baseline_views: video.baseline_views,
            channel_avg_views: video.channel_avg_views,
            source_strategy: video.source_strategy
          }));
          
          setResults(videos);
          if (fastData.grouped_results) {
            console.log('📊 Fast mode grouped results:', fastData.grouped_results);
            setGroupedResults(fastData.grouped_results);
          }
          if (fastData.strategies_used) {
            console.log('📊 Fast mode strategies:', fastData.strategies_used);
            setStrategiesUsed(fastData.strategies_used);
          }
          setIsSearching(false); // Show fast results immediately
          setIsEnhancing(true); // Start AI enhancement indicator
          
          // Now kick off the full AI search in the background
          console.log('🧠 Starting AI enhancement...');
          fetch('/api/youtube/intelligent-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: debouncedQuery,
              page: 1,
              limit: 20,
              fastMode: false, // Full AI mode
              filters: {
                format: searchState.format === 'all' ? null : searchState.format,
                minViews: searchState.minViews,
                maxViews: searchState.maxViews,
                dateFilter: searchState.dateFilter,
                customStartDate: searchState.customStartDate,
                customEndDate: searchState.customEndDate
              }
            })
          })
          .then(response => response.json())
          .then(aiData => {
            // Check if this is still the current search to prevent stale results
            if (currentSearchRef.current !== debouncedQuery) {
              console.log('🚫 Ignoring stale AI results for:', debouncedQuery);
              return;
            }
            
            if (aiData.results) {
              console.log('🧠 AI enhanced results loaded:', aiData.results?.length || 0);
              const aiVideos = (aiData.results || []).map((video: any) => ({
                id: video.id,
                title: video.title,
                channel_id: video.channel_id,
                channel_name: video.channel_name || 'Unknown Channel',
                thumbnail_url: video.thumbnail_url,
                view_count: video.view_count,
                published_at: video.published_at,
                format_type: video.format_type || 'unknown',
                performance_ratio: video.performance_ratio || 0,
                similarity: video.similarity,
                baseline_views: video.baseline_views,
                channel_avg_views: video.channel_avg_views,
                source_strategy: video.source_strategy
              }));
              
              // Merge AI results with existing fast results
              setResults(prev => {
                const existingIds = new Set(prev.map(v => v.id));
                const newVideos = aiVideos.filter(v => !existingIds.has(v.id));
                return [...prev, ...newVideos];
              });
              
              if (aiData.grouped_results) {
                // Merge AI categories with existing fast categories
                setGroupedResults(prev => ({
                  ...prev,
                  ...aiData.grouped_results
                }));
              }
              if (aiData.strategies_used) {
                // Merge AI strategies with existing fast strategies
                setStrategiesUsed(prev => {
                  const existingStrategies = new Set(prev.map(s => s.strategy + ':' + s.query));
                  const newStrategies = aiData.strategies_used.filter(s => 
                    !existingStrategies.has(s.strategy + ':' + s.query)
                  );
                  return [...prev, ...newStrategies];
                });
              }
              setIsEnhancing(false); // AI enhancement complete
            }
          })
          .catch(error => {
            console.error('🧠 AI enhancement failed:', error);
            setIsEnhancing(false); // Stop enhancement indicator even on error
            // Keep the fast results if AI fails
          });
          
          return; // Exit early for fast mode
        }
      }

      // Fallback to full search (for pagination or if fast mode fails)
      const response = await fetch('/api/youtube/intelligent-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: debouncedQuery,
          page: newSearch ? 1 : page,
          limit: 20,
          filters: {
            format: searchState.format === 'all' ? null : searchState.format,
            minViews: searchState.minViews,
            maxViews: searchState.maxViews,
            dateFilter: searchState.dateFilter
          }
        })
      });

      const data = await response.json();
      
      if (response.ok) {
        const videos = (data.results || []).map((video: any) => ({
          id: video.id,
          title: video.title,
          channel_id: video.channel_id,
          channel_name: video.channel_name || 'Unknown Channel',
          thumbnail_url: video.thumbnail_url,
          view_count: video.view_count,
          published_at: video.published_at,
          format_type: video.format_type || 'unknown',
          performance_ratio: video.performance_ratio || 0,
          similarity: video.similarity,
          baseline_views: video.baseline_views,
          channel_avg_views: video.channel_avg_views,
          source_strategy: video.source_strategy
        }));
          
        if (newSearch) {
          setResults(videos);
          // Set grouped results and strategies info for first search
          if (data.grouped_results) {
            setGroupedResults(data.grouped_results);
          }
          if (data.strategies_used) {
            setStrategiesUsed(data.strategies_used);
          }
        } else {
          // Deduplicate when adding more results
          setResults(prev => {
            const existingIds = new Set(prev.map(v => v.id));
            const newVideos = videos.filter(v => !existingIds.has(v.id));
            return [...prev, ...newVideos];
          });
        }
        
        setHasMore(data.hasMore || false);
        setPage(prev => prev + 1);

        // Log the research insights for debugging
        if (newSearch && data.expansion) {
          console.log('🧠 Research insights:', {
            expanded_terms: data.expansion.terms,
            content_types: data.expansion.content_types,
            research_angles: data.expansion.research_angles,
            strategies_used: data.strategies_used
          });
        }
      }
    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: "Search failed",
        description: "Unable to search videos. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSearching(false);
      setIsLoadingMore(false);
    }
  };

  const loadMore = () => {
    if (!isLoadingMore && hasMore) {
      performSearch(false);
    }
  };

  const toggleVideoSelection = (video: Video) => {
    setSelectedVideos(prev => {
      const exists = prev.find(v => v.id === video.id);
      if (exists) {
        return prev.filter(v => v.id !== video.id);
      } else {
        return [...prev, video];
      }
    });
  };

  const removeFromSelection = (videoId: string) => {
    setSelectedVideos(prev => prev.filter(v => v.id !== videoId));
  };

  const exportAnalysisGrid = async () => {
    if (selectedVideos.length === 0) {
      toast({
        title: "No videos selected",
        description: "Please select videos to export",
        variant: "destructive"
      });
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch('/api/youtube/export-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: selectedVideos.map(v => v.id)
        })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pattern-analysis-${new Date().toISOString().split('T')[0]}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
        
        toast({
          title: "Export successful",
          description: "Thumbnail grid downloaded successfully"
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export failed",
        description: "Unable to generate thumbnail grid",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  const copyAllTitles = () => {
    const titles = selectedVideos.map(v => v.title).join('\n');
    navigator.clipboard.writeText(titles);
    toast({
      title: "Titles copied",
      description: `${selectedVideos.length} titles copied to clipboard`
    });
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="h-full flex flex-col bg-[#0f0f0f] min-h-screen">
      {/* Header */}
      <div className="bg-[#0f0f0f] border-b border-[#272727]">
        <div className="max-w-7xl mx-auto px-12 py-6">
          <div className="flex flex-col gap-4">

            {/* Intelligent Search Bar */}
            <div className="flex items-center justify-center w-full relative">
              {/* Search Input */}
              <div className="relative w-full max-w-2xl">
                <Search className="absolute left-6 top-1/2 h-5 w-5 text-[#aaa] transform -translate-y-1/2 z-10" />
                <Input
                  placeholder="Research any video topic... (e.g., 'iPhone review', 'cooking tutorial', 'travel vlog')"
                  value={searchState.query}
                  onChange={(e) => setSearchState(prev => ({ ...prev, query: e.target.value }))}
                  className="pl-14 pr-6 h-12 text-base border border-[#303030] rounded-3xl bg-[#121212] hover:bg-[#1a1a1a] transition-all duration-200 focus:bg-[#1a1a1a] focus:ring-2 focus:ring-blue-500/20 text-white placeholder:text-[#aaa] focus:border-blue-500/50"
                />
                {isSearching && (
                  <Loader2 className="absolute right-6 top-1/2 h-5 w-5 animate-spin text-[#aaa] transform -translate-y-1/2" />
                )}
              </div>
              
              {/* Selected Count */}
              {selectedVideos.length > 0 && (
                <div className="absolute -top-2 right-0">
                  <Button 
                    onClick={() => setShowAnalysisPanel(true)}
                    variant="default"
                    className="rounded-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-lg transition-all duration-200"
                  >
                    📊 {selectedVideos.length} selected
                  </Button>
                </div>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center justify-center gap-3 flex-wrap mt-4">
              {/* Format Filter */}
              <Select
                value={searchState.format || 'all'}
                onValueChange={(value) => setSearchState(prev => ({ ...prev, format: value === 'all' ? null : value }))}
              >
                <SelectTrigger className="w-auto h-8 px-3 rounded-full border border-[#303030] bg-[#272727] hover:bg-[#373737] transition-colors duration-200 text-white font-medium text-sm">
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent className="bg-[#282828] border-[#404040]">
                  {FORMAT_TYPES.map(format => (
                    <SelectItem key={format.value} value={format.value} className="text-white hover:bg-[#404040]">
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* Date Filter */}
              <Popover open={showCustomDatePicker} onOpenChange={setShowCustomDatePicker}>
                <PopoverTrigger asChild>
                  <div>
                    <Select
                      value={searchState.dateFilter}
                      onValueChange={(value) => {
                        setSearchState(prev => ({ ...prev, dateFilter: value }));
                        if (value === 'custom') {
                          setShowCustomDatePicker(true);
                        }
                      }}
                    >
                      <SelectTrigger className="w-auto h-8 px-3 rounded-full border border-[#303030] bg-[#272727] hover:bg-[#373737] transition-colors duration-200 text-white font-medium text-sm min-w-[120px] justify-start">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#282828] border-[#404040]">
                        {DATE_FILTERS.map(filter => (
                          <SelectItem key={filter.value} value={filter.value} className="text-white hover:bg-[#404040]">
                            {filter.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverTrigger>
                {searchState.dateFilter === 'custom' && (
                  <PopoverContent className="w-auto bg-[#1a1a1a] border border-[#404040] p-6 rounded-lg shadow-xl" align="start">
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-semibold text-white text-sm mb-4 flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          Custom Date Range
                        </h4>
                        
                        {/* Date Range Inputs */}
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-[#aaa]">Start Date</label>
                            <Input
                              type="date"
                              value={searchState.customStartDate ? format(searchState.customStartDate, 'yyyy-MM-dd') : ''}
                              onChange={(e) => {
                                const date = e.target.value ? new Date(e.target.value) : null;
                                setSearchState(prev => ({ ...prev, customStartDate: date }));
                              }}
                              className="h-9 text-sm bg-[#272727] border-[#404040] text-white focus:border-blue-500 focus:ring-blue-500/20"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-[#aaa]">End Date</label>
                            <Input
                              type="date"
                              value={searchState.customEndDate ? format(searchState.customEndDate, 'yyyy-MM-dd') : ''}
                              onChange={(e) => {
                                const date = e.target.value ? new Date(e.target.value) : null;
                                setSearchState(prev => ({ ...prev, customEndDate: date }));
                              }}
                              className="h-9 text-sm bg-[#272727] border-[#404040] text-white focus:border-blue-500 focus:ring-blue-500/20"
                            />
                          </div>
                        </div>

                        {/* Date Range Display */}
                        <div className="p-3 bg-[#272727] rounded-md border border-[#404040]">
                          <div className="flex justify-between items-center text-sm">
                            <span className="text-[#aaa]">Selected range:</span>
                            <span className="font-medium text-white">
                              {searchState.customStartDate && searchState.customEndDate
                                ? `${format(searchState.customStartDate, 'MMM d, yyyy')} - ${format(searchState.customEndDate, 'MMM d, yyyy')}`
                                : 'Select start and end dates'
                              }
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-4 border-t border-[#404040]">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSearchState(prev => ({ ...prev, customStartDate: null, customEndDate: null, dateFilter: 'all' }));
                            setShowCustomDatePicker(false);
                          }}
                          className="text-[#aaa] hover:text-white hover:bg-[#333]"
                        >
                          Clear
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => setShowCustomDatePicker(false)}
                          className="bg-blue-600 hover:bg-blue-700 text-white"
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                )}
              </Popover>
              
              
              {/* View Range Filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 rounded-full border border-[#303030] bg-[#272727] hover:bg-[#373737] transition-colors duration-200 text-white font-medium text-sm min-w-[100px] justify-start"
                  >
                    <span className="truncate">{getRangeText(searchState.minViews, searchState.maxViews, 'views')}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 bg-[#1a1a1a] border border-[#404040] p-6 rounded-lg shadow-xl" align="start">
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-semibold text-white text-sm mb-4">View Range</h4>
                      
                      {/* Dark Theme Input Fields */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-[#aaa]">Minimum</label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={searchState.minViews || ''}
                            onChange={(e) => {
                              const value = e.target.value ? parseInt(e.target.value) : null;
                              setSearchState(prev => ({ ...prev, minViews: value }));
                            }}
                            className="h-9 text-sm bg-[#272727] border-[#404040] text-white placeholder:text-[#666] focus:border-blue-500 focus:ring-blue-500/20"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-[#aaa]">Maximum</label>
                          <Input
                            type="number"
                            placeholder="No limit"
                            value={searchState.maxViews || ''}
                            onChange={(e) => {
                              const value = e.target.value ? parseInt(e.target.value) : null;
                              setSearchState(prev => ({ ...prev, maxViews: value }));
                            }}
                            className="h-9 text-sm bg-[#272727] border-[#404040] text-white placeholder:text-[#666] focus:border-blue-500 focus:ring-blue-500/20"
                          />
                        </div>
                      </div>

                      {/* Dark Theme Range Display */}
                      <div className="mt-4 p-3 bg-[#272727] rounded-md border border-[#404040]">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-[#aaa]">Selected range:</span>
                          <span className="font-medium text-white">
                            {formatNumber(searchState.minViews || 0)} - {searchState.maxViews ? formatNumber(searchState.maxViews) : '∞'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-[#404040]">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSearchState(prev => ({ ...prev, minViews: null, maxViews: null }))}
                        className="text-[#aaa] hover:text-white hover:bg-[#333]"
                      >
                        Clear
                      </Button>
                      <div className="text-xs text-[#666]">
                        Press Enter to apply
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Subscriber Range Filter */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 rounded-full border border-[#303030] bg-[#272727] hover:bg-[#373737] transition-colors duration-200 text-white font-medium text-sm min-w-[120px] justify-start"
                  >
                    <span className="truncate">{getRangeText(searchState.minSubs, searchState.maxSubs, 'subs')}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 bg-[#1a1a1a] border border-[#404040] p-6 rounded-lg shadow-xl" align="start">
                  <div className="space-y-6">
                    <div>
                      <h4 className="font-semibold text-white text-sm mb-4">Subscriber Range</h4>
                      
                      {/* Dark Theme Input Fields */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-[#aaa]">Minimum</label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={searchState.minSubs || ''}
                            onChange={(e) => {
                              const value = e.target.value ? parseInt(e.target.value) : null;
                              setSearchState(prev => ({ ...prev, minSubs: value }));
                            }}
                            className="h-9 text-sm bg-[#272727] border-[#404040] text-white placeholder:text-[#666] focus:border-blue-500 focus:ring-blue-500/20"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-[#aaa]">Maximum</label>
                          <Input
                            type="number"
                            placeholder="No limit"
                            value={searchState.maxSubs || ''}
                            onChange={(e) => {
                              const value = e.target.value ? parseInt(e.target.value) : null;
                              setSearchState(prev => ({ ...prev, maxSubs: value }));
                            }}
                            className="h-9 text-sm bg-[#272727] border-[#404040] text-white placeholder:text-[#666] focus:border-blue-500 focus:ring-blue-500/20"
                          />
                        </div>
                      </div>

                      {/* Dark Theme Range Display */}
                      <div className="mt-4 p-3 bg-[#272727] rounded-md border border-[#404040]">
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-[#aaa]">Selected range:</span>
                          <span className="font-medium text-white">
                            {formatNumber(searchState.minSubs || 0)} - {searchState.maxSubs ? formatNumber(searchState.maxSubs) : '∞'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-4 border-t border-[#404040]">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSearchState(prev => ({ ...prev, minSubs: null, maxSubs: null }))}
                        className="text-[#aaa] hover:text-white hover:bg-[#333]"
                      >
                        Clear
                      </Button>
                      <div className="text-xs text-[#666]">
                        Press Enter to apply
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-12 py-8">

        {/* Results */}
        <div className="space-y-8">
          {isSearching && results.length === 0 ? (
            <div className="bg-[#1a1a1a] rounded-2xl border border-[#303030] p-20 text-center">
              <Loader2 className="h-10 w-10 animate-spin mx-auto mb-6 text-[#aaa]" />
              <p className="text-lg text-white font-medium mb-2">
                AI is researching your topic across multiple strategies...
              </p>
              <p className="text-base text-[#aaa]">
                Finding patterns, analyzing performance, discovering insights
              </p>
            </div>
          ) : Object.keys(groupedResults).length > 0 ? (
            <>
              {/* Results header */}
              <div className="flex items-center justify-between mb-6">
                <p className="text-base text-[#aaa]">
                  {results.length} videos found across {Object.keys(groupedResults).length} categories
                  {isEnhancing && <span className="ml-2 text-blue-400 font-medium">• AI is finding more patterns...</span>}
                </p>
              </div>

              {/* Netflix-style Category Groups */}
              {Object.entries(groupedResults).map(([categoryKey, categoryData]) => (
                <div key={categoryKey} className="mb-8">
                  <div 
                    className="flex items-center gap-4 mb-4 cursor-pointer hover:opacity-80 transition-all duration-200"
                    onClick={() => {
                      const newExpanded = new Set(expandedStrategies);
                      if (newExpanded.has(categoryKey)) {
                        newExpanded.delete(categoryKey);
                      } else {
                        newExpanded.add(categoryKey);
                      }
                      setExpandedStrategies(newExpanded);
                    }}
                  >
                    <span className="text-2xl">{categoryData.emoji}</span>
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold text-white mb-1 tracking-tight">{categoryData.category_name}</h2>
                      {/* Show search description for AI-generated categories */}
                      {categoryData.videos.length > 0 && categoryData.videos[0].source_strategy && (
                        <p className="text-sm text-[#aaa]">
                          Search: "{categoryData.videos[0].source_strategy.split(': ')[1] || categoryData.videos[0].source_strategy}"
                        </p>
                      )}
                    </div>
                    <Badge variant="secondary" className="ml-2 bg-[#272727] text-[#aaa] hover:bg-[#373737] border-0 px-3 py-1">
                      {categoryData.videos.length} videos
                    </Badge>
                    <ChevronRight 
                      className={`h-5 w-5 transition-transform duration-200 text-[#aaa] ${expandedStrategies.has(categoryKey) ? 'rotate-90' : ''}`}
                    />
                  </div>

                  {expandedStrategies.has(categoryKey) && (
                    <div className="grid grid-cols-3 gap-4 ml-2">
                      {categoryData.videos.map(video => {
                        const isSelected = selectedVideos.some(v => v.id === video.id);
                        
                        return (
                          <div key={video.id} className="relative">
                            <UnifiedVideoCard
                              video={{
                                id: video.id,
                                title: video.title,
                                view_count: video.view_count,
                                published_at: video.published_at,
                                thumbnail_url: video.thumbnail_url,
                                channel_id: video.channel_id,
                                channel_name: video.channel_name,
                                is_competitor: true
                              }}
                              context={{
                                type: 'packaging',
                                performance_ratio: video.performance_ratio,
                                baseline_views: video.baseline_views || 0,
                                channel_avg_views: video.channel_avg_views
                              }}
                              onClick={() => {
                                // Custom click handler to handle selection
                                toggleVideoSelection(video);
                              }}
                            />
                            {/* Selection Overlay */}
                            {isSelected && (
                              <div className="absolute top-2 left-2 bg-blue-600 text-white rounded-full p-2 pointer-events-none z-10">
                                ✓
                              </div>
                            )}
                            {/* Similarity Badge - We'll add this as an overlay since UnifiedVideoCard doesn't support it */}
                            {video.similarity !== undefined && (
                              <div className="absolute top-2 right-2 bg-green-600 text-white font-bold px-2 py-1 rounded-md text-xs pointer-events-none z-10">
                                {Math.round(video.similarity * 100)}% match
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              
              {/* Load more trigger */}
              <div ref={loadMoreRef} className="h-16 flex items-center justify-center">
                {isLoadingMore && (
                  <Loader2 className="h-8 w-8 animate-spin text-[#aaa]" />
                )}
              </div>
            </>
          ) : searchState.query.length > 2 && !isSearching ? (
            <div className="bg-[#1a1a1a] rounded-2xl border border-[#303030] p-20 text-center">
              <p className="text-lg text-white font-medium mb-2">No videos found matching your research topic</p>
              <p className="text-base text-[#aaa]">
                Try different keywords or adjust your filters
              </p>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] rounded-2xl border border-[#303030] p-20 text-center">
              <Search className="h-16 w-16 text-[#404040] mx-auto mb-6" />
              <p className="text-lg text-white font-medium mb-2">
                Enter any video topic to start researching
              </p>
              <p className="text-base text-[#aaa]">
                Our AI will find patterns, inspiration, and insights automatically
              </p>
            </div>
          )}
        </div>
        </div>
      </div>
      
      {/* Sliding Analysis Panel */}
      <Sheet open={showAnalysisPanel} onOpenChange={setShowAnalysisPanel}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>Analysis Set</SheetTitle>
            <SheetDescription>
              {selectedVideos.length} videos selected for pattern analysis
            </SheetDescription>
          </SheetHeader>
          
          <div className="flex flex-col h-[calc(100vh-12rem)] mt-6">
            {/* Selected Videos List */}
            <ScrollArea className="flex-1 pr-4">
              <div className="pb-4">
                {selectedVideos.length > 0 ? (
                  <div className="space-y-3">
                    {selectedVideos.map(video => (
                      <div key={video.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                        <img 
                          src={video.thumbnail_url}
                          alt={video.title}
                          className="w-20 h-12 object-cover rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium line-clamp-2 mb-1">{video.title}</p>
                          <p className="text-xs text-muted-foreground mb-2">{video.channel_name}</p>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span>{formatNumber(video.view_count)} views</span>
                            <span>•</span>
                            <span className="text-green-500 font-medium">
                              {video.performance_ratio.toFixed(1)}x
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFromSelection(video.id)}
                          className="shrink-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Heart className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                    <p className="text-sm text-muted-foreground">
                      Select videos by clicking the heart icon to build your analysis set
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Export Actions - Fixed at bottom */}
            <div className="shrink-0 pt-4 border-t bg-background space-y-3">
              <Button 
                className="w-full" 
                onClick={exportAnalysisGrid}
                disabled={selectedVideos.length === 0 || isExporting}
                size="lg"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Generate Analysis Grid
              </Button>
              
              <Button 
                variant="outline" 
                className="w-full"
                onClick={copyAllTitles}
                disabled={selectedVideos.length === 0}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy All Titles
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}