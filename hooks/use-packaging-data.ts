'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export interface PackagingVideo {
  id: string;
  title: string;
  view_count: number;
  published_at: string;
  baseline_views: number;
  performance_percent: number;
  thumbnail_url: string;
  is_competitor?: boolean;
  channel_id?: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

interface UsePackagingDataResult {
  data: PackagingVideo[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  pagination: PaginationInfo | null;
  loadMore: () => void;
  loadingMore: boolean;
}

export function usePackagingData(): UsePackagingDataResult {
  const [data, setData] = useState<PackagingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const searchParams = useSearchParams();

  const fetchData = async (page: number = 1, append: boolean = false) => {
    try {
      if (page === 1) {
        setLoading(true);
        setCurrentPage(1);
      } else {
        setLoadingMore(true);
      }
      setError(null);

      const params = new URLSearchParams();
      
      // Add search params to API call
      searchParams.forEach((value, key) => {
        if (value) {
          params.set(key, value);
        }
      });

      // Add pagination params
      params.set('page', page.toString());
      params.set('limit', '24'); // Load 24 items per page for better performance

      const response = await fetch(`/api/youtube/packaging?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch packaging data: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      const newData = result.data || [];
      setData(prevData => append ? [...prevData, ...newData] : newData);
      setPagination(result.pagination || null);
      
      if (append) {
        setCurrentPage(page);
      }
    } catch (err) {
      console.error('Error fetching packaging data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = () => {
    if (pagination?.hasMore && !loadingMore) {
      fetchData(currentPage + 1, true);
    }
  };

  useEffect(() => {
    fetchData(1, false);
  }, [searchParams]);

  return {
    data,
    loading,
    error,
    refetch: () => fetchData(1, false),
    pagination,
    loadMore,
    loadingMore,
  };
}