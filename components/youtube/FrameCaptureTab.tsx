'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { 
  Play, 
  Pause, 
  Camera,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Loader2,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Film
} from 'lucide-react';

interface CapturedFrame {
  id: string;
  dataUrl: string;
  timestamp: number;
  formattedTime: string;
  width: number;
  height: number;
}

export default function FrameCaptureTab() {
  const [videoUrl, setVideoUrl] = useState('');
  const [videoSource, setVideoSource] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoQuality, setVideoQuality] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([]);
  const [frameStep, setFrameStep] = useState(0.042); // Default to 1 frame at 24fps
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoReady, setVideoReady] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Format time from seconds with milliseconds
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  // Load and process YouTube video
  const loadVideo = async () => {
    if (!videoUrl) return;
    
    setIsLoading(true);
    setError('');
    setVideoReady(false);
    setCapturedFrames([]);
    
    try {
      const response = await fetch('/api/youtube/process-video-ytdlp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: videoUrl })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to process video');
      }

      // Set the video source to the downloaded file
      setVideoSource(data.videoUrl);
      setVideoTitle(data.title);
      setVideoQuality(data.quality || 'Unknown');
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
      console.error('Error loading video:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle video loaded
  const handleVideoLoaded = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
    setVideoReady(true);
  };

  // Capture frame from video element
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Set canvas size to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Draw current frame to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to data URL with maximum quality
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    
    // Create frame object
    const frame: CapturedFrame = {
      id: Date.now().toString(),
      dataUrl,
      timestamp: video.currentTime,
      formattedTime: formatTime(video.currentTime),
      width: video.videoWidth,
      height: video.videoHeight
    };
    
    // Add to captured frames
    setCapturedFrames(prev => [...prev, frame]);
  };

  // Player controls
  const togglePlay = () => {
    if (!videoRef.current) return;
    
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const skipBackward = () => seekTo(Math.max(0, currentTime - 10));
  const skipForward = () => seekTo(Math.min(duration, currentTime + 10));
  const frameBackward = () => seekTo(Math.max(0, currentTime - frameStep));
  const frameForward = () => seekTo(Math.min(duration, currentTime + frameStep));

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const changeVolume = (value: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = value;
    setVolume(value);
    if (value === 0) setIsMuted(true);
    else if (isMuted) setIsMuted(false);
  };

  // Download frame
  const downloadFrame = (frame: CapturedFrame) => {
    const link = document.createElement('a');
    link.href = frame.dataUrl;
    link.download = `frame_${frame.formattedTime.replace(/[:.]/g, '-')}.png`;
    link.click();
  };

  // Delete frame
  const deleteFrame = (id: string) => {
    setCapturedFrames(prev => prev.filter(f => f.id !== id));
  };

  // Download all frames
  const downloadAllFrames = () => {
    capturedFrames.forEach((frame, index) => {
      setTimeout(() => downloadFrame(frame), index * 100);
    });
  };

  // Keyboard shortcuts
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (!videoReady) return;
    
    switch(e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          frameBackward();
        } else {
          skipBackward();
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          frameForward();
        } else {
          skipForward();
        }
        break;
      case 'c':
      case 'C':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          captureFrame();
        }
        break;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white" onKeyDown={handleKeyPress} tabIndex={0}>
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Input Section - Match Transcript style */}
        <div className="mb-8">
          <div className="flex gap-3">
            <Input
              type="text"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && loadVideo()}
              disabled={isLoading}
              className="flex-1 bg-neutral-900/50 border-neutral-800 text-white placeholder:text-neutral-500 focus:border-green-500 h-12 px-4 text-base"
            />
            <Button 
              onClick={loadVideo}
              disabled={isLoading || !videoUrl}
              className="bg-green-500 hover:bg-green-600 text-black font-medium min-w-[160px] h-12 text-base"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Loading
                </>
              ) : (
                <>
                  <Film className="w-4 h-4 mr-2" />
                  Download & Load
                </>
              )}
            </Button>
          </div>

          {/* Video Info */}
          {videoTitle && (
            <div className="flex items-center gap-4 mt-4">
              <Badge variant="secondary" className="bg-neutral-800 text-gray-300">
                {videoTitle}
              </Badge>
              {videoQuality && (
                <Badge variant="outline" className="border-green-500 text-green-500">
                  Quality: {videoQuality}
                </Badge>
              )}
            </div>
          )}
          
          {error && (
            <Alert className="mt-4 bg-red-950/50 border-red-900">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-red-400">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        {/* Instructions Alert */}
        {videoReady && (
          <Alert className="mb-6 bg-green-950/50 border-green-900">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-green-400">
              <strong>Video ready!</strong> Navigate to any frame and press 'C' or click "Capture Frame".
              <br />
              <strong>Shortcuts:</strong> Space (play/pause) • Arrow keys (skip) • Shift+Arrow (frame by frame) • C (capture)
            </AlertDescription>
          </Alert>
        )}

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Video Player Card */}
          <div className="lg:col-span-2">
            <Card className="bg-neutral-900/50 border-neutral-800 h-full">
              <CardContent className="p-0">
                <div className="relative aspect-video bg-black rounded-t-lg overflow-hidden">
                {videoSource ? (
                  <video
                    ref={videoRef}
                    src={videoSource}
                    className="w-full h-full object-contain"
                    onLoadedMetadata={handleVideoLoaded}
                    onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onVolumeChange={(e) => {
                      const video = e.target as HTMLVideoElement;
                      setVolume(video.volume);
                      setIsMuted(video.muted);
                    }}
                    onError={(e) => {
                      console.error('Video error:', e);
                      setError('Failed to load video. The file may be corrupted or in an unsupported format.');
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-neutral-500">
                    <div className="text-center p-12">
                      <Camera className="w-16 h-16 mx-auto mb-4 text-neutral-600" />
                      <p className="text-gray-400">Enter a YouTube URL to get started</p>
                      <p className="text-sm mt-2 text-gray-500">The video will be downloaded for frame extraction</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Video Controls */}
              {videoReady && (
                <div className="p-4 bg-neutral-950 rounded-b-lg">
                  {/* Progress Bar */}
                  <div className="mb-4">
                    <Slider
                      value={[currentTime]}
                      max={duration}
                      step={0.001}
                      onValueChange={(value) => seekTo(value[0])}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>{formatTime(currentTime)}</span>
                      <span className="font-mono text-green-500">{currentTime.toFixed(3)}s</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

              {/* Control Buttons */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Button 
                    size="icon" 
                    variant="outline" 
                    onClick={skipBackward} 
                    className="border-neutral-700 hover:bg-neutral-800 text-white"
                    title="Skip back 10s (←)"
                  >
                    <SkipBack className="w-4 h-4" />
                  </Button>
                  
                  <Button 
                    size="icon" 
                    onClick={togglePlay} 
                    className="bg-green-500 hover:bg-green-600 text-black"
                    title="Play/Pause (Space)"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </Button>
                  
                  <Button 
                    size="icon" 
                    variant="outline" 
                    onClick={skipForward} 
                    className="border-neutral-700 hover:bg-neutral-800 text-white"
                    title="Skip forward 10s (→)"
                  >
                    <SkipForward className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-4">
                  {/* Volume */}
                  <div className="flex items-center gap-2">
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={toggleMute} 
                      className="hover:bg-neutral-800 text-gray-400 hover:text-white"
                    >
                      {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </Button>
                    <div className="w-24">
                      <Slider
                        value={[isMuted ? 0 : volume]}
                        max={1}
                        step={0.01}
                        onValueChange={(value) => changeVolume(value[0])}
                      />
                    </div>
                  </div>

                  {/* Capture Button */}
                  <Button 
                    onClick={captureFrame} 
                    className="bg-green-500 hover:bg-green-600 text-black font-medium"
                    title="Capture frame (C)"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Capture Frame
                  </Button>
                </div>
              </div>

              {/* Frame Controls */}
              <div className="flex items-center justify-center gap-2 p-3 bg-neutral-900 rounded-lg">
                <span className="text-sm text-neutral-400 mr-2">Frame control:</span>
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={frameBackward} 
                  className="hover:bg-neutral-800"
                  title="Previous frame (Shift+←)"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  -{frameStep.toFixed(3)}s
                </Button>
                
                <select
                  value={frameStep}
                  onChange={(e) => setFrameStep(Number(e.target.value))}
                  className="bg-neutral-800 text-white px-3 py-1 rounded text-sm mx-2"
                >
                  <option value={0.042}>1 frame (24fps)</option>
                  <option value={0.033}>1 frame (30fps)</option>
                  <option value={0.020}>1 frame (50fps)</option>
                  <option value={0.017}>1 frame (60fps)</option>
                  <option value={0.1}>0.1s</option>
                  <option value={0.5}>0.5s</option>
                  <option value={1}>1s</option>
                </select>
                
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={frameForward} 
                  className="hover:bg-neutral-800"
                  title="Next frame (Shift+→)"
                >
                  +{frameStep.toFixed(3)}s
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
            </CardContent>
          </Card>
        </div>

          {/* Captured Frames Gallery */}
          <div className="lg:col-span-1">
            <Card className="bg-neutral-900/50 border-neutral-800">
              <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg text-white">Captured Frames ({capturedFrames.length})</CardTitle>
                {capturedFrames.length > 0 && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={downloadAllFrames} 
                    className="border-neutral-700 hover:bg-neutral-800 text-white"
                  >
                    <Download className="w-3 h-3 mr-1" />
                    All
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent>
              <ScrollArea className="h-[600px]">
                <div className="space-y-3">
                  {capturedFrames.length === 0 ? (
                    <div className="text-center text-gray-500 py-12">
                      <Camera className="w-12 h-12 mx-auto mb-3 text-neutral-600" />
                      <p className="text-sm text-gray-400">No frames captured yet</p>
                      <p className="text-xs mt-1 text-gray-500">Press 'C' or click capture while video is loaded</p>
                    </div>
                  ) : (
                    capturedFrames.map((frame) => (
                      <div key={frame.id} className="bg-neutral-950 rounded-lg p-3 border border-neutral-800">
                        <div className="relative aspect-video mb-2 bg-black rounded overflow-hidden">
                          <img
                            src={frame.dataUrl}
                            alt={`Frame at ${frame.formattedTime}`}
                            className="w-full h-full object-contain"
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <Badge variant="secondary" className="bg-neutral-800 text-gray-300">
                              {frame.formattedTime}
                            </Badge>
                            <span className="text-xs text-gray-500 ml-2">
                              {frame.width}×{frame.height}
                            </span>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => downloadFrame(frame)}
                              className="h-7 w-7 hover:bg-neutral-800 text-gray-400 hover:text-white"
                              title="Download"
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteFrame(frame.id)}
                              className="h-7 w-7 hover:bg-neutral-800 hover:text-red-500"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
        </div>

        {/* Hidden canvas for frame extraction */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}