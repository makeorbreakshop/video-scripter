'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from 'use-debounce';

export type SortBy = 'performance_percent' | 'view_count' | 'published_at' | 'title';
export type SortOrder = 'asc' | 'desc';
export type PerformanceFilter = 'excellent' | 'good' | 'average' | 'poor' | null;
export type DateFilter = '30days' | '3months' | '6months' | '1year' | null;

export function usePackagingFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get initial values from URL
  const [search, setSearchState] = useState(searchParams.get('search') || '');
  const [sortBy, setSortByState] = useState<SortBy>((searchParams.get('sortBy') as SortBy) || 'performance_percent');
  const [sortOrder, setSortOrderState] = useState<SortOrder>((searchParams.get('sortOrder') as SortOrder) || 'desc');
  const [performanceFilter, setPerformanceFilterState] = useState<PerformanceFilter>(
    (searchParams.get('performanceFilter') as PerformanceFilter) || null
  );
  const [dateFilter, setDateFilterState] = useState<DateFilter>(
    (searchParams.get('dateFilter') as DateFilter) || null
  );

  // Update URL when filters change
  const updateURL = useCallback((params: Record<string, string | null>) => {
    const newSearchParams = new URLSearchParams(searchParams);
    
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        newSearchParams.set(key, value);
      } else {
        newSearchParams.delete(key);
      }
    });

    router.push(`?${newSearchParams.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Debounced search to avoid too many API calls
  const debouncedUpdateSearch = useDebouncedCallback((value: string) => {
    updateURL({ search: value || null });
  }, 300);

  // Setters that update both state and URL
  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    debouncedUpdateSearch(value);
  }, [debouncedUpdateSearch]);

  const setSortBy = useCallback((value: SortBy) => {
    setSortByState(value);
    updateURL({ sortBy: value });
  }, [updateURL]);

  const setSortOrder = useCallback((value: SortOrder) => {
    setSortOrderState(value);
    updateURL({ sortOrder: value });
  }, [updateURL]);

  const setPerformanceFilter = useCallback((value: PerformanceFilter) => {
    setPerformanceFilterState(value);
    updateURL({ performanceFilter: value });
  }, [updateURL]);

  const setDateFilter = useCallback((value: DateFilter) => {
    setDateFilterState(value);
    updateURL({ dateFilter: value });
  }, [updateURL]);

  const clearFilters = useCallback(() => {
    setSearchState('');
    setSortByState('performance_percent');
    setSortOrderState('desc');
    setPerformanceFilterState(null);
    setDateFilterState(null);
    router.push(window.location.pathname, { scroll: false });
  }, [router]);

  const hasActiveFilters = useMemo(() => {
    return !!(search || performanceFilter || dateFilter || 
             sortBy !== 'performance_percent' || sortOrder !== 'desc');
  }, [search, performanceFilter, dateFilter, sortBy, sortOrder]);

  return {
    search,
    setSearch,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    performanceFilter,
    setPerformanceFilter,
    dateFilter,
    setDateFilter,
    clearFilters,
    hasActiveFilters,
  };
}