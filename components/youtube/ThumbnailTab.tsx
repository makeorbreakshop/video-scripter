'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ThumbnailTab() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbnailData, setThumbnailData] = useState<{
    videoId: string;
    title: string;
    channel: string;
    thumbnailUrl: string;
  } | null>(null);

  const fetchThumbnail = async () => {
    if (!url.trim()) {
      setError('Please enter a YouTube URL');
      return;
    }

    setLoading(true);
    setError(null);
    setThumbnailData(null);

    try {
      const response = await fetch('/api/youtube/thumbnail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch thumbnail');
      }

      setThumbnailData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const downloadThumbnail = async () => {
    if (!thumbnailData) return;

    try {
      const response = await fetch(thumbnailData.thumbnailUrl);
      const blob = await response.blob();
      
      const sanitizedTitle = thumbnailData.title
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/__+/g, '_')
        .toLowerCase()
        .substring(0, 50);
      
      const sanitizedChannel = thumbnailData.channel
        .replace(/[^a-z0-9]/gi, '_')
        .replace(/__+/g, '_')
        .toLowerCase()
        .substring(0, 30);
      
      const filename = `${sanitizedTitle}_${sanitizedChannel}.jpg`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download thumbnail');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      fetchThumbnail();
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyPress={handleKeyPress}
          className="flex-1 bg-zinc-900 border-zinc-800 text-white placeholder:text-zinc-500"
        />
        <Button
          onClick={fetchThumbnail}
          disabled={loading}
          className="bg-green-500 hover:bg-green-600 text-black font-medium"
        >
          {loading ? 'Loading...' : 'Get Thumbnail'}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {thumbnailData && (
        <div className="space-y-4">
          <img
            src={thumbnailData.thumbnailUrl}
            alt={thumbnailData.title}
            className="w-full rounded-lg"
          />
          
          <Button
            onClick={downloadThumbnail}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white"
          >
            <Download className="mr-2 h-4 w-4" />
            Download Thumbnail
          </Button>
        </div>
      )}
    </div>
  );
}