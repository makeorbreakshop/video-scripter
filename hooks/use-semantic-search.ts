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
  const [error, setError] = useState<string | null>(null);
  const [queryTime, setQueryTime] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState(0);

  // Debounced search function
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        setTotalResults(0);
        setQueryTime(null);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          query: searchQuery,
          limit: limit.toString(),
          min_score: minScore.toString(),
        });

        const response = await fetch('/api/semantic-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: searchQuery,
            limit: limit,
            min_score: minScore,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Search failed: ${response.statusText}`);
        }

        const data: SearchResponse = await response.json();
        
        setResults(data.results);
        setTotalResults(data.total_results);
        setQueryTime(data.processing_time_ms);
      } catch (err) {
        console.error('Search error:', err);
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
        setTotalResults(0);
        setQueryTime(null);
      } finally {
        setLoading(false);
      }
    },
    [limit, minScore]
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
  }, []);

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    queryTime,
    totalResults,
    clearSearch,
    performSearch: (searchQuery: string) => {
      setQuery(searchQuery);
    },
  };
}