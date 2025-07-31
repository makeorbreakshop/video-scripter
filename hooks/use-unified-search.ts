'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useSearchParams } from 'next/navigation';

export interface UnifiedSearchResult {
  id: string;
  type: 'video' | 'channel';
  title: string;
  channel_id?: string;
  channel_name?: string;
  view_count?: number;
  subscriber_count?: number;
  video_count?: number;
  published_at?: string;
  performance_ratio?: number;
  score: number;
  match_type: 'semantic' | 'keyword' | 'channel' | 'direct';
  thumbnail_url?: string;
  description?: string;
}

export interface UnifiedSearchFilters {
  performanceFilter?: string;
  dateFilter?: string;
  minViews?: number;
  maxViews?: number;
  competitorFilter?: string;
}

interface UseUnifiedSearchOptions {
  debounceMs?: number;
  limit?: number;
  type?: 'all' | 'videos' | 'channels' | 'semantic';
  initialFilters?: UnifiedSearchFilters;
}

interface UseUnifiedSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  searchType: 'all' | 'videos' | 'channels' | 'semantic';
  setSearchType: (type: 'all' | 'videos' | 'channels' | 'semantic') => void;
  results: UnifiedSearchResult[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  queryTime: number | null;
  totalResults: number;
  hasMore: boolean;
  searchIntent: any;
  filters: UnifiedSearchFilters;
  setFilters: (filters: UnifiedSearchFilters) => void;
  clearSearch: () => void;
  loadMoreResults: () => void;
  refetch: () => void;
}

export function useUnifiedSearch({
  debounceMs = 300,
  limit = 20,
  type: initialType = 'all',
  initialFilters = {}
}: UseUnifiedSearchOptions = {}): UseUnifiedSearchReturn {
  const searchParams = useSearchParams();
  
  // State
  const [query, setQueryState] = useState(searchParams.get('q') || '');
  const [searchType, setSearchTypeState] = useState<'all' | 'videos' | 'channels' | 'semantic'>(
    (searchParams.get('type') as any) || initialType
  );
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searchIntent, setSearchIntent] = useState<any>(null);
  const [filters, setFilters] = useState<UnifiedSearchFilters>(initialFilters);
  const [offset, setOffset] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // Perform search
  const performSearch = useCallback(async (
    searchQuery: string,
    searchType: 'all' | 'videos' | 'channels' | 'semantic',
    currentFilters: UnifiedSearchFilters,
    currentOffset = 0,
    append = false
  ) => {
    if (!searchQuery.trim() && !append) {
      setResults([]);
      setTotalResults(0);
      setHasMore(false);
      return;
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      if (!append) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      // Build query params
      const params = new URLSearchParams({
        query: searchQuery,
        type: searchType,
        limit: limit.toString(),
        offset: currentOffset.toString(),
        ...Object.entries(currentFilters).reduce((acc, [key, value]) => {
          if (value !== undefined && value !== null) {
            acc[key] = value.toString();
          }
          return acc;
        }, {} as Record<string, string>)
      });

      const response = await fetch(`/api/search/unified?${params}`, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Search failed');
      }

      const data = await response.json();

      if (append) {
        setResults(prev => [...prev, ...data.results]);
      } else {
        setResults(data.results);
      }
      
      setTotalResults(data.total_results);
      setQueryTime(data.query_time_ms);
      setHasMore(data.has_more);
      setSearchIntent(data.search_intent);
      setOffset(currentOffset + data.results.length);

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Search error:', err);
        setError(err.message || 'Failed to perform search');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [limit]);

  // Debounced search
  const debouncedSearch = useDebouncedCallback(
    (searchQuery: string, searchType: 'all' | 'videos' | 'channels' | 'semantic', currentFilters: UnifiedSearchFilters) => {
      performSearch(searchQuery, searchType, currentFilters, 0, false);
    },
    debounceMs
  );

  // Update query
  const setQuery = useCallback((newQuery: string) => {
    setQueryState(newQuery);
    setOffset(0);
    
    // Clear results immediately for instant feedback when query changes significantly
    if (newQuery.length === 0 || (query.length > 0 && Math.abs(newQuery.length - query.length) > 3)) {
      setResults([]);
      setTotalResults(0);
    }
    
    debouncedSearch(newQuery, searchType, filters);
  }, [searchType, filters, debouncedSearch, query]);

  // Update search type
  const setSearchType = useCallback((newType: 'all' | 'videos' | 'channels' | 'semantic') => {
    setSearchTypeState(newType);
    setOffset(0);
    if (query) {
      performSearch(query, newType, filters, 0, false);
    }
  }, [query, filters, performSearch]);

  // Update filters
  const updateFilters = useCallback((newFilters: UnifiedSearchFilters) => {
    setFilters(newFilters);
    setOffset(0);
    if (query) {
      performSearch(query, searchType, newFilters, 0, false);
    }
  }, [query, searchType, performSearch]);

  // Load more results
  const loadMoreResults = useCallback(() => {
    if (!loadingMore && hasMore) {
      performSearch(query, searchType, filters, offset, true);
    }
  }, [query, searchType, filters, offset, loadingMore, hasMore, performSearch]);

  // Clear search
  const clearSearch = useCallback(() => {
    setQueryState('');
    setResults([]);
    setTotalResults(0);
    setHasMore(false);
    setOffset(0);
    setError(null);
    setQueryTime(null);
    setSearchIntent(null);
  }, []);

  // Refetch current search
  const refetch = useCallback(() => {
    if (query) {
      performSearch(query, searchType, filters, 0, false);
    }
  }, [query, searchType, filters, performSearch]);

  // Initial search if query exists
  useEffect(() => {
    if (query) {
      performSearch(query, searchType, filters, 0, false);
    }
  }, []); // Only on mount

  return {
    query,
    setQuery,
    searchType,
    setSearchType,
    results,
    loading,
    loadingMore,
    error,
    queryTime,
    totalResults,
    hasMore,
    searchIntent,
    filters,
    setFilters: updateFilters,
    clearSearch,
    loadMoreResults,
    refetch
  };
}