'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  Copy, 
  Loader2, 
  FileText,
  Clock,
  Eye,
  Calendar,
  ChevronRight,
  Sparkles,
  MessageSquare,
  FileJson,
  FileCode,
  X,
  Play
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

export default function TranscriptTabImproved() {
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
  const [selectedChapterIndex, setSelectedChapterIndex] = useState<number | null>(null);

  // Load cached transcripts on mount
  useEffect(() => {
    const cached = localStorage.getItem('youtube-transcripts');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setCachedTranscripts(parsed);
        
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

    const updatedCache = [newCache, ...cachedTranscripts.filter(t => t.videoId !== videoId)].slice(0, 20);
    setCachedTranscripts(updatedCache);
    localStorage.setItem('youtube-transcripts', JSON.stringify(updatedCache));
  };

  const loadFromCache = (cached: CachedTranscript) => {
    setUrl(cached.url);
    setMetadata(cached.metadata);
    setTranscript(cached.transcript);
    setChapters(cached.chapters);
    setFullText(cached.fullText);
    setError(null);
    setSuccess(`Loaded cached transcript`);
    setTimeout(() => setSuccess(null), 3000);
  };

  const clearCache = () => {
    localStorage.removeItem('youtube-transcripts');
    setCachedTranscripts([]);
    setSuccess('Cache cleared');
    setTimeout(() => setSuccess(null), 3000);
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
      return `${(count / 1_000_000).toFixed(1)}M`;
    } else if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}K`;
    }
    return count.toLocaleString();
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
      setSuccess('Transcription complete!');
      setTimeout(() => setSuccess(null), 3000);
      
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
        thumbnailUrl: '', // Keep empty string but handle with conditional rendering
        viewCount: 0
      });
      
      setTranscript(data.transcript);
      setChapters(data.chapters || []);
      setFullText(data.fullText);
      setSuccess('Audio file transcribed successfully!');
      setTimeout(() => setSuccess(null), 3000);
      
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
        setSuccess(`Fetched ${data.comments.length} comments`);
      }
      setTimeout(() => setSuccess(null), 3000);
      
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
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Clean Header */}
      <div className="border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-[#00ff00]/10 rounded-lg">
              <Sparkles className="w-6 h-6 text-[#00ff00]" />
            </div>
            <h1 className="text-2xl font-semibold">YouTube Transcript</h1>
          </div>
          <p className="text-neutral-400 text-sm">
            AI-powered transcription with Whisper • Supports videos up to 90 minutes
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Input Section - Cleaner Card */}
        <Card className="bg-neutral-900/50 border-neutral-800 backdrop-blur-sm mb-8">
          <div className="p-6">
            {/* Input Mode Tabs */}
            <div className="flex gap-2 mb-4">
              <Button
                onClick={() => setInputMode('url')}
                variant={inputMode === 'url' ? 'default' : 'outline'}
                className={inputMode === 'url' 
                  ? 'bg-[#00ff00] text-black hover:bg-[#00ff00]/90' 
                  : 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-600'}
                size="sm"
              >
                YouTube URL
              </Button>
              <Button
                onClick={() => setInputMode('file')}
                variant={inputMode === 'file' ? 'default' : 'outline'}
                className={inputMode === 'file' 
                  ? 'bg-[#00ff00] text-black hover:bg-[#00ff00]/90' 
                  : 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-600'}
                size="sm"
              >
                Upload Audio
              </Button>
            </div>

            {/* URL Input */}
            {inputMode === 'url' ? (
              <div className="flex gap-3">
                <Input
                  type="text"
                  placeholder="https://youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 bg-neutral-950 border-neutral-800 h-12 text-base 
                           placeholder:text-neutral-600 focus:border-[#00ff00]/50 
                           focus:ring-1 focus:ring-[#00ff00]/20 transition-all"
                />
                <Button
                  onClick={handleTranscribe}
                  disabled={loading || !url}
                  className="bg-[#00ff00] text-black hover:bg-[#00ff00]/90 h-12 px-6 
                           font-medium disabled:opacity-50 transition-all"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Transcribe'
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
                            setError('File exceeds 25MB. Compress with: ffmpeg -i input.mp3 -b:a 32k -ar 16000 -ac 1 output.mp3');
                            setAudioFile(null);
                          } else {
                            setAudioFile(file);
                            setError(null);
                          }
                        }
                      }}
                      className="bg-neutral-950 border-neutral-800 h-12 text-base 
                               file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 
                               file:text-sm file:font-medium file:bg-[#00ff00] file:text-black 
                               hover:file:bg-[#00ff00]/90 file:cursor-pointer cursor-pointer"
                    />
                  </div>
                  <Button
                    onClick={handleTranscribeFile}
                    disabled={loading || !audioFile}
                    className="bg-[#00ff00] text-black hover:bg-[#00ff00]/90 h-12 px-6 
                             font-medium disabled:opacity-50 transition-all"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Transcribe File'
                    )}
                  </Button>
                </div>
                {audioFile && (
                  <div className="text-sm text-neutral-400">
                    Selected: {audioFile.name} ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </div>
                )}
                <div className="text-xs text-neutral-500 bg-neutral-950 rounded p-2 font-mono">
                  Max: 25MB | Compress: ffmpeg -i input.mp3 -b:a 32k -ar 16000 -ac 1 output.mp3
                </div>
              </div>
            )}

            {/* Recent Transcripts - Cleaner Design */}
            {cachedTranscripts.length > 0 && (
              <div className="mt-6 pt-6 border-t border-neutral-800">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm font-medium text-neutral-400">Recent Transcripts</span>
                  <button
                    onClick={clearCache}
                    className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <div className="grid gap-2 max-h-64 overflow-y-auto">
                  {cachedTranscripts.map((cached) => (
                    <button
                      key={cached.videoId}
                      className="flex items-center gap-3 p-3 bg-neutral-950 rounded-lg 
                               hover:bg-neutral-900 transition-all text-left group"
                      onClick={() => loadFromCache(cached)}
                    >
                      {cached.metadata.thumbnailUrl && (
                        <img 
                          src={cached.metadata.thumbnailUrl}
                          alt=""
                          className="w-20 h-12 object-cover rounded"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {cached.metadata.title}
                        </p>
                        <p className="text-xs text-neutral-500 mt-1">
                          {formatDistanceToNow(new Date(cached.cachedAt), { addSuffix: true })}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-[#00ff00] transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Status Messages - Subtle */}
            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {error}
              </div>
            )}
            
            {success && (
              <div className="mt-4 p-3 bg-[#00ff00]/10 border border-[#00ff00]/20 rounded-lg text-sm text-[#00ff00]">
                {success}
              </div>
            )}
          </div>
        </Card>

        {/* Results Section */}
        {metadata && (
          <>
            {/* Video Info Card - Cleaner Layout */}
            <Card className="bg-neutral-900/50 border-neutral-800 backdrop-blur-sm mb-6">
              <div className="p-6">
                <div className="flex gap-6">
                  {metadata.thumbnailUrl && (
                    <div className="relative group">
                      <img 
                        src={metadata.thumbnailUrl} 
                        alt={metadata.title}
                        className="w-64 h-36 object-cover rounded-lg"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 
                                    transition-opacity rounded-lg flex items-center justify-center">
                        <Play className="w-12 h-12 text-white" />
                      </div>
                    </div>
                  )}
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold mb-1">{metadata.title}</h2>
                    <p className="text-neutral-400 mb-4">{metadata.channel}</p>
                    
                    <div className="flex items-center gap-6 text-sm">
                      <div className="flex items-center gap-2 text-neutral-500">
                        <Eye className="w-4 h-4" />
                        <span>{formatViewCount(metadata.viewCount)} views</span>
                      </div>
                      <div className="flex items-center gap-2 text-neutral-500">
                        <Clock className="w-4 h-4" />
                        <span>{formatTime(metadata.duration)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-neutral-500">
                        <Calendar className="w-4 h-4" />
                        <span>{formatDistanceToNow(new Date(metadata.publishedAt), { addSuffix: true })}</span>
                      </div>
                    </div>

                    {chapters.length > 0 && (
                      <div className="mt-4">
                        <Badge className="bg-[#00ff00]/10 text-[#00ff00] border-[#00ff00]/20 font-normal">
                          {chapters.length} chapters available
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Action Buttons - Grouped Better */}
            <div className="flex items-center gap-2 mb-6">
              <div className="flex items-center bg-neutral-900/50 rounded-lg border border-neutral-800 p-1">
                <Button
                  onClick={handleCopy}
                  variant="ghost"
                  size="sm"
                  className="text-neutral-400 hover:text-white hover:bg-neutral-800"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
                <div className="w-px h-6 bg-neutral-800" />
                <Button
                  onClick={() => handleDownload('txt')}
                  variant="ghost"
                  size="sm"
                  className="text-neutral-400 hover:text-white hover:bg-neutral-800"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  TXT
                </Button>
                <div className="w-px h-6 bg-neutral-800" />
                <Button
                  onClick={() => handleDownload('srt')}
                  variant="ghost"
                  size="sm"
                  className="text-neutral-400 hover:text-white hover:bg-neutral-800"
                >
                  <FileCode className="w-4 h-4 mr-2" />
                  SRT
                </Button>
                <div className="w-px h-6 bg-neutral-800" />
                <Button
                  onClick={() => handleDownload('json')}
                  variant="ghost"
                  size="sm"
                  className="text-neutral-400 hover:text-white hover:bg-neutral-800"
                >
                  <FileJson className="w-4 h-4 mr-2" />
                  JSON
                </Button>
              </div>

              {comments.length === 0 && (
                <Button
                  onClick={handleFetchComments}
                  disabled={loadingComments}
                  className="bg-[#00ff00] text-black hover:bg-[#00ff00]/90 font-medium"
                >
                  {loadingComments ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Loading...
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

            {/* Transcript Content - Better Typography */}
            <Card className="bg-neutral-900/50 border-neutral-800 backdrop-blur-sm">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="border-b border-neutral-800">
                  <TabsList className="h-12 bg-transparent p-0 rounded-none w-full justify-start">
                    <TabsTrigger 
                      value="transcript" 
                      className="data-[state=active]:bg-transparent rounded-none border-b-2 
                               border-transparent data-[state=active]:border-[#00ff00] 
                               data-[state=active]:text-white text-neutral-400 px-6"
                    >
                      Full Transcript
                    </TabsTrigger>
                    {chapters.length > 0 && (
                      <TabsTrigger 
                        value="chapters" 
                        className="data-[state=active]:bg-transparent rounded-none border-b-2 
                                 border-transparent data-[state=active]:border-[#00ff00] 
                                 data-[state=active]:text-white text-neutral-400 px-6"
                      >
                        Chapters
                      </TabsTrigger>
                    )}
                    <TabsTrigger 
                      value="timestamped" 
                      className="data-[state=active]:bg-transparent rounded-none border-b-2 
                               border-transparent data-[state=active]:border-[#00ff00] 
                               data-[state=active]:text-white text-neutral-400 px-6"
                    >
                      Timestamped
                    </TabsTrigger>
                    {comments.length > 0 && (
                      <TabsTrigger 
                        value="comments" 
                        className="data-[state=active]:bg-transparent rounded-none border-b-2 
                                 border-transparent data-[state=active]:border-[#00ff00] 
                                 data-[state=active]:text-white text-neutral-400 px-6"
                      >
                        Comments ({comments.length})
                      </TabsTrigger>
                    )}
                  </TabsList>
                </div>

                <TabsContent value="transcript" className="p-8">
                  <ScrollArea className="h-[600px] pr-4">
                    <div className="prose prose-invert max-w-none">
                      <p className="text-base leading-relaxed text-neutral-200 whitespace-pre-wrap">
                        {fullText}
                      </p>
                    </div>
                  </ScrollArea>
                </TabsContent>

                {chapters.length > 0 && (
                  <TabsContent value="chapters" className="p-0">
                    <div className="flex h-[600px]">
                      {/* Chapter Navigation Sidebar */}
                      <div className="w-80 border-r border-neutral-800 overflow-y-auto sticky top-0">
                        <div className="p-4">
                          <h3 className="text-sm font-medium text-neutral-400 mb-3">Chapters</h3>
                          <div className="space-y-1">
                            {chapters.map((chapter, index) => (
                              <button
                                key={index}
                                onClick={() => {
                                  // Scroll to chapter in the transcript
                                  const chapterElement = document.getElementById(`chapter-${index}`);
                                  if (chapterElement) {
                                    chapterElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }
                                }}
                                className={`w-full text-left p-3 rounded-lg transition-all chapter-nav-item ${
                                  selectedChapterIndex === index 
                                    ? 'bg-[#00ff00]/10 border border-[#00ff00]/20' 
                                    : 'hover:bg-neutral-800'
                                }`}
                                data-chapter-index={index}
                              >
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-[#00ff00] font-mono">
                                    {chapter.formattedTime}
                                  </span>
                                  <span className={`text-sm ${
                                    selectedChapterIndex === index ? 'text-white' : 'text-neutral-300'
                                  }`}>
                                    {chapter.title}
                                  </span>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Full Transcript with Chapter Headers */}
                      <div 
                        className="flex-1 p-8 overflow-y-auto"
                        onScroll={(e) => {
                          // Update active chapter based on scroll position
                          const container = e.currentTarget;
                          const scrollTop = container.scrollTop;
                          
                          // Find which chapter section is currently in view
                          let activeIndex = 0;
                          chapters.forEach((_, index) => {
                            const chapterElement = document.getElementById(`chapter-${index}`);
                            if (chapterElement) {
                              const rect = chapterElement.getBoundingClientRect();
                              const containerRect = container.getBoundingClientRect();
                              const relativeTop = rect.top - containerRect.top;
                              
                              if (relativeTop <= 100) {
                                activeIndex = index;
                              }
                            }
                          });
                          
                          if (activeIndex !== selectedChapterIndex) {
                            setSelectedChapterIndex(activeIndex);
                          }
                        }}
                      >
                        <div className="space-y-8">
                          {chapters.map((chapter, chapterIndex) => {
                            // Get all transcript segments for this chapter
                            const chapterSegments = transcript.filter(s => {
                              const nextChapter = chapters[chapterIndex + 1];
                              return s.start >= chapter.startTime && 
                                (nextChapter ? s.start < nextChapter.startTime : true);
                            });
                            
                            return (
                              <div key={chapterIndex} id={`chapter-${chapterIndex}`} className="scroll-mt-4">
                                {/* Chapter Header */}
                                <div className="mb-4 pb-2 border-b border-neutral-800">
                                  <h2 className="text-xl font-semibold text-white">
                                    {chapter.title}
                                  </h2>
                                  <span className="text-xs text-neutral-500 font-mono">
                                    {chapter.formattedTime}
                                  </span>
                                </div>
                                
                                {/* Chapter Content */}
                                <p className="text-base leading-relaxed text-neutral-200 whitespace-pre-wrap">
                                  {chapterSegments.map(s => s.text).join(' ')}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                )}

                <TabsContent value="timestamped" className="p-8">
                  <ScrollArea className="h-[600px] pr-4">
                    <div className="space-y-3">
                      {transcript.map((segment, index) => (
                        <div key={index} className="flex gap-4 group">
                          <span className="text-xs font-mono text-[#00ff00] mt-1 min-w-[60px]">
                            {formatTime(segment.start)}
                          </span>
                          <p className="text-base leading-relaxed text-neutral-200 group-hover:text-white transition-colors">
                            {segment.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {comments.length > 0 && (
                  <TabsContent value="comments" className="p-8">
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-6">
                        {comments.map((comment) => (
                          <div key={comment.id} className="group">
                            <div className="flex gap-3">
                              <div className="w-10 h-10 bg-neutral-800 rounded-full flex items-center justify-center text-sm font-medium">
                                {comment.author.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium">{comment.author}</span>
                                  {comment.isAuthorReply && (
                                    <Badge className="bg-[#00ff00]/10 text-[#00ff00] border-[#00ff00]/20 text-xs">
                                      Creator
                                    </Badge>
                                  )}
                                  <span className="text-xs text-neutral-500">
                                    {formatDistanceToNow(new Date(comment.publishedAt), { addSuffix: true })}
                                  </span>
                                </div>
                                <p className="text-sm text-neutral-300 mb-2" 
                                   dangerouslySetInnerHTML={{ __html: comment.text }} />
                                <div className="flex items-center gap-4 text-xs text-neutral-500">
                                  <span>👍 {comment.likeCount.toLocaleString()}</span>
                                  {comment.replyCount > 0 && (
                                    <span>💬 {comment.replyCount}</span>
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