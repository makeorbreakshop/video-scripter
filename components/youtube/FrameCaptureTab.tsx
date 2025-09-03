'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  AlertCircle
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
    <div className="h-full bg-[rgb(15,15,15)] text-white" onKeyDown={handleKeyPress} tabIndex={0}>
      <div className="flex h-full">
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* URL Input */}
          <div className="p-4 border-b border-neutral-800">
            <div className="flex gap-2 mb-3">
              <Input
                type="text"
                placeholder="Enter YouTube URL (e.g., https://www.youtube.com/watch?v=...)"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && loadVideo()}
                className="flex-1 bg-neutral-900 border-neutral-700 text-white"
                disabled={isLoading}
              />
              <Button 
                onClick={loadVideo}
                disabled={isLoading || !videoUrl}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Downloading...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download & Load
                  </>
                )}
              </Button>
            </div>

            {/* Title and status */}
            {videoTitle && (
              <div className="text-sm text-neutral-400">
                <p>
                  <span className="font-medium">Video:</span> {videoTitle}
                </p>
                {videoQuality && (
                  <p>
                    <span className="font-medium">Quality:</span> <span className="text-green-400">{videoQuality}</span>
                  </p>
                )}
              </div>
            )}
            
            {error && (
              <Alert className="mt-2 bg-red-950 border-red-800">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-red-200">
                  {error}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Instructions */}
          {videoReady && (
            <Alert className="m-4 bg-green-950 border-green-800">
              <Camera className="h-4 w-4" />
              <AlertDescription className="text-green-200">
                <strong>Video ready!</strong> Navigate to any frame and press 'C' or click "Capture Frame".
                <br />
                <strong>Shortcuts:</strong> Space (play/pause) • Arrow keys (skip) • Shift+Arrow (frame by frame) • C (capture)
              </AlertDescription>
            </Alert>
          )}

          {/* Video Player */}
          <div className="flex-1 relative bg-black">
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
                <div className="text-center">
                  <Camera className="w-16 h-16 mx-auto mb-4" />
                  <p>Enter a YouTube URL to get started</p>
                  <p className="text-sm mt-2">The video will be downloaded for frame extraction</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {videoReady && (
            <div className="p-4 border-t border-neutral-800">
              {/* Progress Bar */}
              <div className="mb-4">
                <Slider
                  value={[currentTime]}
                  max={duration}
                  step={0.001}
                  onValueChange={(value) => seekTo(value[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-neutral-400 mt-1">
                  <span>{formatTime(currentTime)}</span>
                  <span className="font-mono">{currentTime.toFixed(3)}s</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    onClick={skipBackward} 
                    className="hover:bg-neutral-800"
                    title="Skip back 10s (←)"
                  >
                    <SkipBack className="w-5 h-5" />
                  </Button>
                  
                  <Button 
                    size="icon" 
                    onClick={togglePlay} 
                    className="bg-white text-black hover:bg-neutral-200"
                    title="Play/Pause (Space)"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </Button>
                  
                  <Button 
                    size="icon" 
                    variant="ghost" 
                    onClick={skipForward} 
                    className="hover:bg-neutral-800"
                    title="Skip forward 10s (→)"
                  >
                    <SkipForward className="w-5 h-5" />
                  </Button>
                </div>

                <div className="flex items-center gap-4">
                  {/* Volume */}
                  <div className="flex items-center gap-2">
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      onClick={toggleMute} 
                      className="hover:bg-neutral-800"
                    >
                      {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
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
                    className="bg-blue-600 hover:bg-blue-700"
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
        </div>

        {/* Captured Frames Sidebar */}
        <div className="w-96 border-l border-neutral-800 flex flex-col">
          <div className="p-4 border-b border-neutral-800">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Captured Frames ({capturedFrames.length})</h3>
              {capturedFrames.length > 0 && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={downloadAllFrames} 
                  className="border-neutral-700 hover:bg-neutral-800"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Download All
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {capturedFrames.length === 0 ? (
                <div className="text-center text-neutral-500 py-8">
                  <Camera className="w-12 h-12 mx-auto mb-3" />
                  <p className="text-sm">No frames captured yet</p>
                  <p className="text-xs mt-1">Press 'C' or click capture while video is loaded</p>
                </div>
              ) : (
                capturedFrames.map((frame) => (
                  <Card key={frame.id} className="bg-neutral-900 border-neutral-800">
                    <CardContent className="p-3">
                      <div className="relative aspect-video mb-2 bg-black rounded overflow-hidden">
                        <img
                          src={frame.dataUrl}
                          alt={`Frame at ${frame.formattedTime}`}
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <Badge variant="secondary" className="bg-neutral-800">
                            {frame.formattedTime}
                          </Badge>
                          <span className="text-xs text-neutral-500 ml-2">
                            {frame.width}×{frame.height}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => downloadFrame(frame)}
                            className="h-8 w-8 hover:bg-neutral-800"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteFrame(frame.id)}
                            className="h-8 w-8 hover:bg-neutral-800 hover:text-red-500"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Hidden canvas for frame extraction */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}