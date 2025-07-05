/**
 * Refresh Button Component
 * Handles manual analytics data refresh
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Database } from 'lucide-react';
import { isAuthenticated } from '@/lib/youtube-oauth';

export function RefreshButton() {
  const [isRefreshingChannel, setIsRefreshingChannel] = useState(false);
  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Handle authentication state on client side only
  useEffect(() => {
    setIsClient(true);
    setIsUserAuthenticated(isAuthenticated());
  }, []);

  // Update authentication state after OAuth
  useEffect(() => {
    const updateAuthState = () => {
      setIsUserAuthenticated(isAuthenticated());
    };
    
    // Listen for storage changes (when OAuth completes in another tab)
    window.addEventListener('storage', updateAuthState);
    
    return () => {
      window.removeEventListener('storage', updateAuthState);
    };
  }, []);


  const handleRefreshChannelAnalytics = async () => {
    try {
      // Check if user is authenticated first
      if (!isAuthenticated()) {
        toast({
          title: 'Authentication required',
          description: 'Please authenticate with YouTube first using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      setIsRefreshingChannel(true);

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      toast({
        title: 'Starting channel analytics refresh...',
        description: 'Importing new videos and updating baseline analytics for your channel.',
      });

      // Call the unified refresh endpoint
      const response = await fetch('/api/youtube/refresh-channel-analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          channelId: 'UCjWkNxpp3UHdEavpM_19--Q' // Actual YouTube channel ID
        }),
      });

      const result = await response.json();

      if (result.success) {
        const { stats } = result;
        toast({
          title: 'Channel Analytics Refresh Complete! 🎉',
          description: `Imported ${stats.newVideos} new videos and updated ${stats.updatedBaselines} baseline analytics. Found ${stats.totalChannelVideos} total videos on your channel.`,
        });

        // Trigger page refresh to show new data
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        toast({
          title: 'Channel refresh failed',
          description: result.message || 'There was an error refreshing your channel analytics.',
          variant: 'destructive',
        });
      }

    } catch (error) {
      console.error('Channel analytics refresh error:', error);
      toast({
        title: 'Refresh failed',
        description: error instanceof Error ? error.message : 'There was an error refreshing channel analytics. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshingChannel(false);
    }
  };


  return (
    <>
      <Button 
        onClick={handleRefreshChannelAnalytics} 
        disabled={!isClient || !isUserAuthenticated || isRefreshingChannel}
        variant="default"
      >
        <Database className={`h-4 w-4 mr-2 ${isRefreshingChannel ? 'animate-pulse' : ''}`} />
        {isRefreshingChannel ? 'Refreshing...' : 'Refresh Analytics'}
      </Button>

    </>
  );
}