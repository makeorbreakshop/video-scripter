'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';

interface VideoCountProps {
  type?: 'videos' | 'channels' | 'both';
  fallback?: string;
  className?: string;
}

export function VideoCount({ type = 'videos', fallback = '500,000+', className }: VideoCountProps) {
  const [count, setCount] = useState<string>(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const { data, error } = await supabase
          .from('analytics_stats')
          .select('total_videos, total_channels')
          .single();

        if (error || !data) {
          setCount(fallback);
          return;
        }

        const formatNumber = (num: number) => {
          if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
          if (num >= 1000) return `${Math.round(num / 1000)}K`;
          return num.toLocaleString();
        };

        if (type === 'videos') {
          setCount(formatNumber(data.total_videos));
        } else if (type === 'channels') {
          setCount(formatNumber(data.total_channels));
        } else if (type === 'both') {
          setCount(`${formatNumber(data.total_videos)} videos, ${formatNumber(data.total_channels)} channels`);
        }
      } catch (error) {
        console.error('Error fetching video count:', error);
        setCount(fallback);
      } finally {
        setLoading(false);
      }
    };

    fetchCount();
  }, [type, fallback]);

  if (loading) {
    return <span className={className}>{fallback}</span>;
  }

  return <span className={className}>{count}</span>;
}