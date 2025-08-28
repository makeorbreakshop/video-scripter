'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Download, 
  Copy, 
  Loader2, 
  FileText, 
  Clock,
  Hash,
  CheckCircle,
  AlertCircle,
  Sparkles,
  MessageSquare
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Chapter {
  title: string;
  startTime: number;
  endTime?: number;
  formattedTime: string;
}

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  chapter?: string;
}

interface VideoMetadata {
  title: string;
  channel: string;
  duration: number;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  description?: string;
}

interface CachedTranscript {
  videoId: string;
  url: string;
  metadata: VideoMetadata;
  transcript: TranscriptSegment[];
  chapters: Chapter[];
  fullText: string;
  cachedAt: string;
}

interface Comment {
  id: string;
  author: string;
  authorChannelId?: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
  replyCount: number;
  isAuthorReply?: boolean;
}

export default function TranscriptTab() {
  const [url, setUrl] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [inputMode, setInputMode] = useState<'url' | 'file'>('url');
  const [loading, setLoading] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [fullText, setFullText] = useState('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsMetadata, setCommentsMetadata] = useState<any>(null);
  
  const [activeTab, setActiveTab] = useState('transcript');
  const [copied, setCopied] = useState(false);
  const [cachedTranscripts, setCachedTranscripts] = useState<CachedTranscript[]>([]);

  // Load cached transcripts on mount
  useEffect(() => {
    const cached = localStorage.getItem('youtube-transcripts');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setCachedTranscripts(parsed);
        
        // If we have cached transcripts and no current transcript, load the most recent
        if (parsed.length > 0 && !metadata) {
          const mostRecent = parsed[0];
          setUrl(mostRecent.url);
          setMetadata(mostRecent.metadata);
          setTranscript(mostRecent.transcript);
          setChapters(mostRecent.chapters);
          setFullText(mostRecent.fullText);
        }
      } catch (e) {
        console.error('Failed to load cached transcripts:', e);
      }
    }
  }, []);

  // Save to cache whenever we get new transcript data
  const saveToCache = (videoId: string, data: any) => {
    const newCache: CachedTranscript = {
      videoId,
      url,
      metadata: data.metadata,
      transcript: data.transcript,
      chapters: data.chapters || [],
      fullText: data.fullText,
      cachedAt: new Date().toISOString()
    };

    // Add to beginning of cache array, keep max 10 transcripts
    const updatedCache = [newCache, ...cachedTranscripts.filter(t => t.videoId !== videoId)].slice(0, 10);
    setCachedTranscripts(updatedCache);
    localStorage.setItem('youtube-transcripts', JSON.stringify(updatedCache));
  };

  // Load from cache
  const loadFromCache = (cached: CachedTranscript) => {
    setUrl(cached.url);
    setMetadata(cached.metadata);
    setTranscript(cached.transcript);
    setChapters(cached.chapters);
    setFullText(cached.fullText);
    setError(null);
    setSuccess(`Loaded cached transcript from ${new Date(cached.cachedAt).toLocaleString()}`);
  };

  // Clear cache
  const clearCache = () => {
    localStorage.removeItem('youtube-transcripts');
    setCachedTranscripts([]);
    setSuccess('Cache cleared successfully');
  };

  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatViewCount = (count: number): string => {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M views`;
    } else if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}K views`;
    }
    return `${count.toLocaleString()} views`;
  };

  const extractVideoId = (url: string): string | null => {
    const patterns = [
      /youtube\.com\/watch\?v=([^&]+)/,
      /youtu\.be\/([^?]+)/,
      /youtube\.com\/embed\/([^?]+)/,
      /youtube\.com\/v\/([^?]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const handleTranscribe = async () => {
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError('Invalid YouTube URL');
      return;
    }

    // Check cache first
    const cached = cachedTranscripts.find(t => t.videoId === videoId);
    if (cached) {
      loadFromCache(cached);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch('/api/youtube/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, includeChapters: true })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to transcribe video');
      }

      const data = await response.json();
      
      setMetadata(data.metadata);
      setTranscript(data.transcript);
      setChapters(data.chapters || []);
      setFullText(data.fullText);
      setSuccess('Video transcribed successfully!');
      
      // Save to cache
      saveToCache(videoId, data);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleTranscribeFile = async () => {
    if (!audioFile) {
      setError('Please select an audio file');
      return;
    }

    // Check file size (25MB limit)
    if (audioFile.size > 25 * 1024 * 1024) {
      setError('File size exceeds 25MB limit. Please compress the audio file first.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('filename', audioFile.name);

      const response = await fetch('/api/youtube/transcribe', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to transcribe audio file');
      }

      const data = await response.json();
      
      // Set metadata for uploaded file
      setMetadata({
        title: audioFile.name.replace(/\.[^/.]+$/, ''), // Remove extension
        channel: 'Uploaded File',
        duration: 0,
        publishedAt: new Date().toISOString(),
        thumbnailUrl: '',
        viewCount: 0
      });
      
      setTranscript(data.transcript);
      setChapters(data.chapters || []);
      setFullText(data.fullText);
      setSuccess('Audio file transcribed successfully!');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchComments = async () => {
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError('Invalid YouTube URL');
      return;
    }

    setLoadingComments(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await fetch('/api/youtube/fetch-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, maxComments: 1000 })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch comments');
      }

      const data = await response.json();
      
      setComments(data.comments);
      setCommentsMetadata(data.metadata);
      
      if (data.comments.length === 0 && data.message) {
        setSuccess(data.message);
      } else {
        setSuccess(`Fetched ${data.comments.length} comments (${data.metadata.apiCallsUsed} API calls used)`);
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred fetching comments');
    } finally {
      setLoadingComments(false);
    }
  };

  const handleCopy = () => {
    const textToCopy = chapters.length > 0 
      ? formatTranscriptWithChapters()
      : fullText;
    
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTranscriptWithChapters = (): string => {
    let formatted = `${metadata?.title}\nby ${metadata?.channel}\n\n`;
    formatted += '=== CHAPTERS ===\n';
    
    chapters.forEach(chapter => {
      formatted += `${chapter.formattedTime} - ${chapter.title}\n`;
    });
    
    formatted += '\n=== TRANSCRIPT ===\n\n';
    
    let currentChapter = '';
    transcript.forEach(segment => {
      if (segment.chapter && segment.chapter !== currentChapter) {
        currentChapter = segment.chapter;
        formatted += `\n[${currentChapter}]\n\n`;
      }
      formatted += `${segment.text} `;
    });
    
    return formatted;
  };

  const handleDownloadComments = (format: 'txt' | 'json') => {
    if (!comments || comments.length === 0) {
      setError('No comments to download');
      return;
    }

    let content = '';
    let filename = `${metadata?.title || 'video'}-comments.${format}`;
    
    switch (format) {
      case 'txt':
        content = formatCommentsAsText();
        break;
      case 'json':
        content = JSON.stringify({
          metadata: commentsMetadata,
          comments: comments
        }, null, 2);
        break;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatCommentsAsText = (): string => {
    let formatted = `YouTube Comments for: ${metadata?.title}\n`;
    formatted += `Channel: ${metadata?.channel}\n`;
    formatted += `Total Comments: ${commentsMetadata?.totalComments || 'Unknown'}\n`;
    formatted += `Comments Fetched: ${comments.length}\n`;
    formatted += '='.repeat(80) + '\n\n';
    
    comments.forEach((comment, index) => {
      formatted += `#${index + 1} | ${comment.author}`;
      if (comment.isAuthorReply) {
        formatted += ' [CREATOR]';
      }
      formatted += `\n`;
      formatted += `👍 ${comment.likeCount.toLocaleString()} likes | 💬 ${comment.replyCount} replies\n`;
      formatted += `Posted: ${new Date(comment.publishedAt).toLocaleDateString()}\n`;
      formatted += `${comment.text}\n`;
      formatted += '-'.repeat(60) + '\n\n';
    });
    
    return formatted;
  };

  const handleDownload = (format: 'txt' | 'srt' | 'json') => {
    let content = '';
    let filename = `${metadata?.title || 'transcript'}.${format}`;
    
    switch (format) {
      case 'txt':
        content = chapters.length > 0 
          ? formatTranscriptWithChapters()
          : fullText;
        break;
        
      case 'srt':
        content = generateSRT();
        break;
        
      case 'json':
        content = JSON.stringify({
          metadata,
          chapters,
          transcript
        }, null, 2);
        break;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateSRT = (): string => {
    let srt = '';
    transcript.forEach((segment, index) => {
      const startTime = formatTimeForSRT(segment.start);
      const endTime = formatTimeForSRT(segment.start + segment.duration);
      
      srt += `${index + 1}\n`;
      srt += `${startTime} --> ${endTime}\n`;
      srt += `${segment.text}\n\n`;
    });
    return srt;
  };

  const formatTimeForSRT = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="min-h-screen bg-[rgb(15,15,15)] text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-[#00ff00]" />
            YouTube Whisper Transcription
          </h1>
          <p className="text-neutral-400">
            Transcribe YouTube videos with Whisper AI - automatic audio compression for longer videos (up to ~90 minutes)
          </p>
        </div>

        {/* Input Section */}
        <Card className="bg-[rgb(39,39,39)] border-neutral-700 mb-6">
          <CardContent className="p-6">
            {/* Input Mode Tabs */}
            <div className="flex gap-2 mb-4">
              <Button
                onClick={() => setInputMode('url')}
                variant={inputMode === 'url' ? 'default' : 'outline'}
                className={inputMode === 'url' 
                  ? 'bg-[#00ff00] text-black hover:bg-[#88ff00]' 
                  : 'border-neutral-600 text-neutral-400 hover:text-white hover:border-neutral-500'}
                size="sm"
              >
                YouTube URL
              </Button>
              <Button
                onClick={() => setInputMode('file')}
                variant={inputMode === 'file' ? 'default' : 'outline'}
                className={inputMode === 'file' 
                  ? 'bg-[#00ff00] text-black hover:bg-[#88ff00]' 
                  : 'border-neutral-600 text-neutral-400 hover:text-white hover:border-neutral-500'}
                size="sm"
              >
                Upload Audio File
              </Button>
            </div>

            {/* URL Input */}
            {inputMode === 'url' ? (
              <div className="flex gap-3">
                <Input
                  type="text"
                  placeholder="Enter YouTube URL (e.g., https://youtube.com/watch?v=...)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 bg-neutral-800 border-neutral-600 text-white placeholder:text-neutral-500 focus:border-[#00ff00] focus:ring-[#00ff00]/20"
                />
                <Button
                  onClick={handleTranscribe}
                  disabled={loading || !url}
                  className="bg-[#00ff00] text-black hover:bg-[#88ff00] font-semibold px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Transcribing...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      Transcribe
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* File Upload Input */
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      type="file"
                      accept=".mp3,.m4a,.wav,.webm,.ogg"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 25 * 1024 * 1024) {
                            setError('File size exceeds 25MB. Please compress it first using: ffmpeg -i input.mp3 -b:a 32k -ar 16000 -ac 1 output.mp3');
                            setAudioFile(null);
                          } else {
                            setAudioFile(file);
                            setError(null);
                          }
                        }
                      }}
                      className="bg-neutral-800 border-neutral-600 text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#00ff00] file:text-black hover:file:bg-[#88ff00] file:cursor-pointer cursor-pointer"
                    />
                  </div>
                  <Button
                    onClick={handleTranscribeFile}
                    disabled={loading || !audioFile}
                    className="bg-[#00ff00] text-black hover:bg-[#88ff00] font-semibold px-6 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Transcribing...
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4 mr-2" />
                        Transcribe File
                      </>
                    )}
                  </Button>
                </div>
                {audioFile && (
                  <div className="text-sm text-neutral-400">
                    Selected: {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </div>
                )}
                <div className="text-xs text-neutral-500">
                  Max file size: 25MB. To compress: <code className="bg-neutral-800 px-1 rounded">ffmpeg -i input.mp3 -b:a 32k -ar 16000 -ac 1 output.mp3</code>
                </div>
              </div>
            )}

            {/* Recent Transcripts Cache */}
            {cachedTranscripts.length > 0 && (
              <div className="mt-6 pt-6 border-t border-neutral-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-neutral-300">Recent Transcripts ({cachedTranscripts.length})</h3>
                  <Button
                    onClick={clearCache}
                    variant="ghost"
                    className="text-xs text-neutral-500 hover:text-red-400"
                  >
                    Clear Cache
                  </Button>
                </div>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {cachedTranscripts.map((cached) => (
                    <div 
                      key={cached.videoId}
                      className="flex items-center justify-between p-2 bg-neutral-800 rounded-lg cursor-pointer hover:bg-neutral-700 transition-colors"
                      onClick={() => loadFromCache(cached)}
                    >
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-sm text-white truncate">{cached.metadata.title}</p>
                        <p className="text-xs text-neutral-500">
                          Cached {new Date(cached.cachedAt).toLocaleDateString()} at {new Date(cached.cachedAt).toLocaleTimeString()}
                        </p>
                      </div>
                      <Badge className="bg-[#00ff00]/10 text-[#00ff00] border-[#00ff00]/20 text-xs">
                        Load
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Messages */}
            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-400">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}
            
            {success && (
              <div className="mt-4 p-3 bg-[#00ff00]/10 border border-[#00ff00]/20 rounded-lg flex items-center gap-2 text-[#00ff00]">
                <CheckCircle className="w-4 h-4" />
                {success}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Section */}
        {metadata && (
          <>
            {/* Video Info Card */}
            <Card className="bg-[rgb(39,39,39)] border-neutral-700 mb-6">
              <CardContent className="p-6">
                <div className="flex gap-6">
                  <img 
                    src={metadata.thumbnailUrl} 
                    alt={metadata.title}
                    className="w-48 h-27 object-cover rounded-lg"
                  />
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold mb-2">{metadata.title}</h2>
                    <p className="text-neutral-400 mb-3">{metadata.channel}</p>
                    <div className="flex gap-4 text-sm text-neutral-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {formatTime(metadata.duration)}
                      </span>
                      <span>{formatViewCount(metadata.viewCount)}</span>
                      <span>
                        {formatDistanceToNow(new Date(metadata.publishedAt), { addSuffix: true })}
                      </span>
                    </div>
                    {chapters.length > 0 && (
                      <Badge className="mt-3 bg-[#00ff00]/10 text-[#00ff00] border-[#00ff00]/20">
                        <Hash className="w-3 h-3 mr-1" />
                        {chapters.length} chapters detected
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-3 mb-6">
              <Button
                onClick={handleCopy}
                variant="outline"
                className="border-neutral-600 hover:bg-neutral-800 text-white"
              >
                <Copy className="w-4 h-4 mr-2" />
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </Button>
              
              <Button
                onClick={() => handleDownload('txt')}
                variant="outline"
                className="border-neutral-600 hover:bg-neutral-800 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                Download TXT
              </Button>
              
              <Button
                onClick={() => handleDownload('srt')}
                variant="outline"
                className="border-neutral-600 hover:bg-neutral-800 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                Download SRT
              </Button>
              
              <Button
                onClick={() => handleDownload('json')}
                variant="outline"
                className="border-neutral-600 hover:bg-neutral-800 text-white"
              >
                <Download className="w-4 h-4 mr-2" />
                Download JSON
              </Button>
              
              {comments.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="border-neutral-600 hover:bg-neutral-800 text-white"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Comments ({comments.length})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="bg-neutral-800 border-neutral-700">
                    <DropdownMenuItem 
                      onClick={() => handleDownloadComments('txt')}
                      className="text-white hover:bg-neutral-700 cursor-pointer"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Download as TXT
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => handleDownloadComments('json')}
                      className="text-white hover:bg-neutral-700 cursor-pointer"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download as JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  onClick={handleFetchComments}
                  disabled={loadingComments || !url}
                  className="bg-[#00ff00] text-black hover:bg-[#88ff00] font-semibold disabled:opacity-50"
                >
                  {loadingComments ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Getting Comments...
                    </>
                  ) : (
                    <>
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Get Comments
                    </>
                  )}
                </Button>
              )}
            </div>

            {/* Transcript Tabs */}
            <Card className="bg-[rgb(39,39,39)] border-neutral-700">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full bg-neutral-800 border-b border-neutral-700 rounded-none">
                  <TabsTrigger 
                    value="transcript" 
                    className="flex-1 data-[state=active]:bg-[#00ff00]/10 data-[state=active]:text-[#00ff00]"
                  >
                    Full Transcript
                  </TabsTrigger>
                  {chapters.length > 0 && (
                    <TabsTrigger 
                      value="chapters" 
                      className="flex-1 data-[state=active]:bg-[#00ff00]/10 data-[state=active]:text-[#00ff00]"
                    >
                      Chapters
                    </TabsTrigger>
                  )}
                  <TabsTrigger 
                    value="timestamped" 
                    className="flex-1 data-[state=active]:bg-[#00ff00]/10 data-[state=active]:text-[#00ff00]"
                  >
                    Timestamped
                  </TabsTrigger>
                  {comments.length > 0 && (
                    <TabsTrigger 
                      value="comments" 
                      className="flex-1 data-[state=active]:bg-[#00ff00]/10 data-[state=active]:text-[#00ff00]"
                    >
                      Comments ({comments.length})
                    </TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="transcript" className="p-6">
                  <ScrollArea className="h-[500px] w-full pr-4">
                    <div className="whitespace-pre-wrap text-neutral-300 leading-relaxed">
                      {fullText}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {chapters.length > 0 && (
                  <TabsContent value="chapters" className="p-6">
                    <ScrollArea className="h-[500px] w-full pr-4">
                      {chapters.map((chapter, index) => (
                        <div key={index} className="mb-6">
                          <div className="flex items-center gap-3 mb-2">
                            <Badge className="bg-[#00ff00]/10 text-[#00ff00] border-[#00ff00]/20">
                              {chapter.formattedTime}
                            </Badge>
                            <h3 className="font-semibold text-white">
                              {chapter.title}
                            </h3>
                          </div>
                          <div className="text-neutral-400 leading-relaxed pl-20">
                            {transcript
                              .filter(s => {
                                const inChapter = s.start >= chapter.startTime && 
                                  (chapter.endTime ? s.start < chapter.endTime : true);
                                return inChapter;
                              })
                              .map(s => s.text)
                              .join(' ')}
                          </div>
                          {index < chapters.length - 1 && (
                            <Separator className="my-4 bg-neutral-700" />
                          )}
                        </div>
                      ))}
                    </ScrollArea>
                  </TabsContent>
                )}

                <TabsContent value="timestamped" className="p-6">
                  <ScrollArea className="h-[500px] w-full pr-4">
                    {transcript.map((segment, index) => (
                      <div key={index} className="mb-3 flex gap-3">
                        <Badge className="bg-neutral-800 text-[#00ff00] border-neutral-700 min-w-[80px] justify-center">
                          {formatTime(segment.start)}
                        </Badge>
                        <p className="text-neutral-300 flex-1">
                          {segment.text}
                        </p>
                      </div>
                    ))}
                  </ScrollArea>
                </TabsContent>

                {comments.length > 0 && (
                  <TabsContent value="comments" className="p-6">
                    <ScrollArea className="h-[500px] w-full pr-4">
                      <div className="space-y-4">
                        {commentsMetadata && (
                          <div className="mb-4 p-3 bg-neutral-800 rounded-lg">
                            <div className="flex items-center justify-between text-sm text-neutral-400">
                              <span>Total Comments: {commentsMetadata.totalComments?.toLocaleString()}</span>
                              <span>Showing: {comments.length} most relevant</span>
                            </div>
                          </div>
                        )}
                        
                        {comments.map((comment, index) => (
                          <div key={comment.id} className="border-b border-neutral-700 pb-4 last:border-0">
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 w-10 h-10 bg-neutral-700 rounded-full flex items-center justify-center text-sm font-semibold text-[#00ff00]">
                                {comment.author.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-semibold text-white">
                                    {comment.author}
                                  </span>
                                  {comment.isAuthorReply && (
                                    <Badge className="bg-[#00ff00]/10 text-[#00ff00] border-[#00ff00]/20 text-xs">
                                      Creator
                                    </Badge>
                                  )}
                                  <span className="text-xs text-neutral-500">
                                    {formatDistanceToNow(new Date(comment.publishedAt), { addSuffix: true })}
                                  </span>
                                </div>
                                <p className="text-neutral-300 mb-2 whitespace-pre-wrap" 
                                   dangerouslySetInnerHTML={{ __html: comment.text }} />
                                <div className="flex items-center gap-4 text-sm text-neutral-500">
                                  <span className="flex items-center gap-1">
                                    👍 {comment.likeCount.toLocaleString()}
                                  </span>
                                  {comment.replyCount > 0 && (
                                    <span className="flex items-center gap-1">
                                      💬 {comment.replyCount} {comment.replyCount === 1 ? 'reply' : 'replies'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                )}
              </Tabs>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}