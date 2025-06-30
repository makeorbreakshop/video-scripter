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
}

interface UsePackagingDataResult {
  data: PackagingVideo[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePackagingData(): UsePackagingDataResult {
  const [data, setData] = useState<PackagingVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      
      // Add search params to API call
      searchParams.forEach((value, key) => {
        if (value) {
          params.set(key, value);
        }
      });

      const response = await fetch(`/api/youtube/packaging?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch packaging data: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }

      setData(result.data || []);
    } catch (err) {
      console.error('Error fetching packaging data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchParams]);

  return {
    data,
    loading,
    error,
    refetch: fetchData,
  };
}