'use client';

import { useState, useEffect, useCallback } from 'react';

interface SearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  similarity_score: number;
  thumbnail_url: string;
}

interface SearchResponse {
  results: SearchResult[];
  total_results: number;
  has_more: boolean;
  total_available: number;
  current_page: number;
  processing_time_ms: number;
  query: string;
}

interface UseSemanticSearchOptions {
  debounceMs?: number;
  minScore?: number;
  limit?: number;
}

export function useSemanticSearch(options: UseSemanticSearchOptions = {}) {
  const { debounceMs = 500, minScore = 0.1, limit = 20 } = options;
  
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Initial search function (resets results)
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setTotalResults(0);
        setQueryTime(null);
        setError(null);
        setHasMore(false);
        setTotalAvailable(0);
        setCurrentPage(1);
        return;
      }

      setLoading(true);
      setError(null);
      setCurrentPage(1);

      try {
        const response = await fetch('/api/semantic-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: searchQuery,
            limit: limit,
            min_score: minScore,
            offset: 0, // Start from beginning
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Search failed: ${response.statusText}`);
        }

        const data: SearchResponse = await response.json();
        
        setResults(data.results);
        setTotalResults(data.total_results);
        setHasMore(data.has_more);
        setTotalAvailable(data.total_available);
        setQueryTime(data.processing_time_ms);
      } catch (err) {
        console.error('Search error:', err);
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotalResults(0);
        setHasMore(false);
        setTotalAvailable(0);
        setQueryTime(null);
      } finally {
        setLoading(false);
      }
    },
    [limit, minScore]
  );

  // Load more results function (appends to existing results)
  const loadMoreResults = useCallback(
    async () => {
      if (!query.trim() || !hasMore || loadingMore) {
        return;
      }

      setLoadingMore(true);
      setError(null);

      try {
        const offset = results.length;
        
        const response = await fetch('/api/semantic-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: query,
            limit: limit,
            min_score: minScore,
            offset: offset,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Load more failed: ${response.statusText}`);
        }

        const data: SearchResponse = await response.json();
        
        // Append new results to existing ones, but filter out duplicates
        setResults(prev => {
          const existingIds = new Set(prev.map(result => result.video_id));
          const newResults = data.results.filter(result => !existingIds.has(result.video_id));
          return [...prev, ...newResults];
        });
        setTotalResults(prev => prev + data.total_results);
        setHasMore(data.has_more);
        setTotalAvailable(data.total_available);
        setCurrentPage(data.current_page);
      } catch (err) {
        console.error('Load more error:', err);
        setError(err instanceof Error ? err.message : 'Failed to load more results');
      } finally {
        setLoadingMore(false);
      }
    },
    [query, limit, minScore, hasMore, loadingMore, results.length]
  );

  // Debounce search queries
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, debounceMs);

    return () => clearTimeout(timeoutId);
  }, [query, performSearch, debounceMs]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
    setTotalResults(0);
    setQueryTime(null);
    setError(null);
    setHasMore(false);
    setTotalAvailable(0);
    setCurrentPage(1);
  }, []);

  return {
    query,
    setQuery,
    results,
    loading,
    loadingMore,
    error,
    queryTime,
    totalResults,
    hasMore,
    totalAvailable,
    currentPage,
    clearSearch,
    loadMoreResults,
    performSearch: (searchQuery: string) => {
      setQuery(searchQuery);
    },
  };
}