/**
 * Hook for polling Analytics progress updates
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

interface ProgressData {
  isRunning: boolean;
  [key: string]: any;
}

export function useAnalyticsProgress(operationId: string | null, enabled: boolean = true) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const startPolling = useCallback(() => {
    if (!operationId || !enabled) return;
    setIsPolling(true);
  }, [operationId, enabled]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!isPolling || !operationId) return;

    const pollProgress = async () => {
      try {
        const response = await fetch(`/api/youtube/analytics/progress?id=${operationId}`);
        if (response.ok) {
          const data = await response.json();
          console.log('🔄 Progress hook received data:', data);
          if (data.success && data.operation) {
            console.log('📈 Setting progress data:', data.operation.progress);
            setProgress(data.operation.progress);
            setError(null);
            
            // Stop polling if operation is complete
            if (!data.operation.isActive) {
              console.log('✅ Operation completed, stopping polling');
              setIsPolling(false);
            }
          }
        } else {
          console.error('❌ Progress fetch failed:', response.status);
          setError('Failed to fetch progress');
        }
      } catch (err) {
        console.error('❌ Progress fetch error:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      }
    };

    // Initial poll
    pollProgress();

    // Set up polling interval
    const interval = setInterval(pollProgress, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [isPolling, operationId]);

  return {
    progress,
    error,
    isPolling,
    startPolling,
    stopPolling
  };
}