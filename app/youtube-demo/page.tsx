'use client';

import { useState, useEffect } from 'react';
import YouTubeThemeProvider, { useYouTubeTheme } from '@/components/youtube-replica/YouTubeThemeProvider';
import YouTubeGrid from '@/components/youtube-replica/YouTubeGrid';
import YouTubeHeader from '@/components/youtube-replica/YouTubeHeader';
import YouTubeSidebar from '@/components/youtube-replica/YouTubeSidebar';

interface VideoData {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_name: string;
  view_count: number;
  published_at: string;
  duration: string;
}

function YouTubeDemoContent() {
  const { theme, toggleTheme } = useYouTubeTheme();
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('view_count');
  const [limit, setLimit] = useState(20);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/youtube-demo/videos?limit=${limit}&sortBy=${sortBy}&order=desc`);
      if (!response.ok) {
        throw new Error('Failed to fetch videos');
      }
      
      const data = await response.json();
      setVideos(data.videos);
    } catch (err) {
      console.error('Error fetching videos:', err);
      setError('Failed to load videos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, [sortBy, limit]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading videos...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500 text-lg">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-[rgb(15,15,15)]">
      {/* YouTube Header */}
      <YouTubeHeader />
      
      <div className="flex flex-1 overflow-hidden">
        {/* YouTube Sidebar */}
        <YouTubeSidebar />
        
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto bg-white dark:bg-[rgb(15,15,15)]">
          {/* Video Grid - Homepage Style */}
          <div className="pt-6 pb-8">
            <YouTubeGrid videos={videos} />
          </div>
        </main>
      </div>
    </div>
  );
}

export default function YouTubeDemoPage() {
  return (
    <YouTubeThemeProvider>
      <YouTubeDemoContent />
    </YouTubeThemeProvider>
  );
}