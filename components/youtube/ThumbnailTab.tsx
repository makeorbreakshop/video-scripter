'use client';

import { useState } from 'react';
import { 
  Download, 
  Loader2, 
  Image as ImageIcon,
  Sparkles,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function ThumbnailTab() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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
    setSuccess(null);
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
      setSuccess('Thumbnail loaded successfully!');
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
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Input Section - Match Transcript style */}
        <div className="mb-8">
          <div className="flex gap-3">
            <Input
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={loading}
              className="flex-1 bg-neutral-900/50 border-neutral-800 text-white placeholder:text-neutral-500 focus:border-green-500 h-12 px-4 text-base"
            />
            <Button
              onClick={fetchThumbnail}
              disabled={loading || !url.trim()}
              className="bg-green-500 hover:bg-green-600 text-black font-medium min-w-[140px] h-12 text-base"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading
                </>
              ) : (
                <>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Get Thumbnail
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <Alert className="mb-6 bg-red-950/50 border-red-900">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-red-400">{error}</AlertDescription>
          </Alert>
        )}

        {/* Success Alert */}
        {success && !error && (
          <Alert className="mb-6 bg-green-950/50 border-green-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-green-400">{success}</AlertDescription>
          </Alert>
        )}

        {/* Thumbnail Display */}
        {thumbnailData && (
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardHeader>
              <div className="space-y-2">
                <CardTitle className="text-xl text-white">{thumbnailData.title}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="bg-neutral-800 text-gray-300">
                    {thumbnailData.channel}
                  </Badge>
                  <Badge variant="outline" className="border-green-500 text-green-500">
                    Video ID: {thumbnailData.videoId}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative group">
                <img
                  src={thumbnailData.thumbnailUrl}
                  alt={thumbnailData.title}
                  className="w-full rounded-lg border border-neutral-800"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                  <Button
                    onClick={downloadThumbnail}
                    size="lg"
                    className="bg-green-500 hover:bg-green-600 text-black font-medium"
                  >
                    <Download className="mr-2 h-5 w-5" />
                    Download Full Resolution
                  </Button>
                </div>
              </div>
              
              <Separator className="bg-neutral-800" />
              
              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-400">
                  Maximum available resolution • JPG format
                </div>
                <Button
                  onClick={downloadThumbnail}
                  variant="outline"
                  className="border-neutral-700 hover:bg-neutral-800 text-white"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Thumbnail
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}