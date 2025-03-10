"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Database, Search, Video, RefreshCw, AlertCircle } from "lucide-react";
import Link from "next/link";

// Types for our video data
interface VideoItem {
  id: string;
  title: string;
  channelTitle: string;
  viewCount: number;
  totalChunks: number;
  processed: boolean;
  processingDate: string;
  analyzed?: boolean;
  analysisPhases?: number; // Number of completed analysis phases (0-5)
}

interface ProcessStatus {
  status: 'idle' | 'processing' | 'success' | 'error';
  message: string;
  videoId?: string;
  totalChunks?: number;
  step?: 'downloading' | 'transcribing' | 'processing' | 'vectorizing' | 'storing' | 
         'analyzing-structure' | 'analyzing-audience' | 'analyzing-performance' | 
         'analyzing-implementation' | 'analyzing-pattern';
  analysisPhase?: number; // 1-5 for the Skyscraper phases
  progress?: number; // 0-100
  alreadyExists?: boolean;
  title?: string;
}

export default function DatabasePage() {
  const [url, setUrl] = useState("");
  const [processStatus, setProcessStatus] = useState<ProcessStatus>({ 
    status: 'idle', 
    message: '' 
  });
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chunkingMethod, setChunkingMethod] = useState("standard");
  
  // Fetch existing videos when the page loads
  useEffect(() => {
    fetchVideos();
  }, []);
  
  // Function to fetch processed videos from the database
  const fetchVideos = async () => {
    try {
      setIsLoading(true);
      
      // You'll need to create this API endpoint
      const response = await fetch("/api/vector/videos", {
        method: "GET",
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch videos");
      }
      
      const data = await response.json();
      setVideos(data.videos || []);
    } catch (error) {
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Process a new video
  const processVideo = async () => {
    if (!url.trim()) return;
    
    try {
      // Initialize processing with more detailed state
      setProcessStatus({ 
        status: 'processing', 
        message: 'Starting video processing...',
        step: 'downloading',
        progress: 5
      });

      // Set up a simulation of progress updates for the demo
      // In production, you'd use server-sent events or websockets
      const simulateProgress = () => {
        const steps = ['downloading', 'transcribing', 'processing', 'vectorizing', 'storing'];
        let currentStep = 0;
        let progress = 5;
        
        const interval = setInterval(() => {
          progress += 5;
          
          if (progress >= 95) {
            clearInterval(interval);
          } else if (progress % 20 === 0 && currentStep < 4) {
            currentStep++;
          }
          
          setProcessStatus(prev => ({
            ...prev,
            step: steps[currentStep] as any,
            progress,
            message: `${steps[currentStep].charAt(0).toUpperCase() + steps[currentStep].slice(1)} the video content...`
          }));
        }, 500);
        
        return interval;
      };
      
      const progressInterval = simulateProgress();
      
      const response = await fetch("/api/vector/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: url,
          userId: "00000000-0000-0000-0000-000000000000", // Default user ID, replace with actual auth
          chunkingMethod: chunkingMethod // Add the chunking method to the request
        }),
      });
      
      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to process video");
      }
      
      // Check if the video already existed in the database
      if (data.alreadyExists) {
        setProcessStatus({ 
          status: 'success', 
          message: 'Video already exists in database',
          videoId: data.videoId,
          totalChunks: data.totalChunks,
          progress: 100,
          step: 'storing',
          alreadyExists: true,
          title: data.title
        });
      } else {
        setProcessStatus({ 
          status: 'success', 
          message: 'Video processed successfully!',
          videoId: data.videoId,
          totalChunks: data.totalChunks,
          progress: 100,
          step: 'storing'
        });
      }
      
      // Refresh the video list
      fetchVideos();
      
      // Clear the input
      setUrl("");
    } catch (error) {
      setProcessStatus({ 
        status: 'error', 
        message: error instanceof Error ? error.message : "An unknown error occurred" 
      });
    }
  };
  
  // Analyze a processed video with Skyscraper method
  const analyzeVideo = async (videoId: string) => {
    try {
      // Update UI to show processing
      setProcessStatus({ 
        status: 'processing', 
        message: 'Starting video analysis...',
        step: 'analyzing-structure',
        analysisPhase: 1,
        progress: 5,
        videoId
      });

      // Simulate progress for demo purposes
      const simulateAnalysisProgress = () => {
        const phases = [
          'analyzing-structure',    // Phase 1
          'analyzing-audience',     // Phase 2
          'analyzing-performance',  // Phase 3
          'analyzing-implementation', // Phase 4
          'analyzing-pattern'       // Phase 5
        ];
        
        let currentPhase = 0;
        let progress = 5;
        
        const interval = setInterval(() => {
          progress += 3;
          
          if (progress >= 95) {
            clearInterval(interval);
          } else if (progress % 20 === 0 && currentPhase < 4) {
            currentPhase++;
            
            setProcessStatus(prev => ({
              ...prev,
              step: phases[currentPhase] as any,
              analysisPhase: currentPhase + 1,
              progress,
              message: `Phase ${currentPhase + 1}: ${getPhaseTitle(currentPhase + 1)}`
            }));
          } else {
            setProcessStatus(prev => ({
              ...prev,
              progress
            }));
          }
        }, 500);
        
        return interval;
      };
      
      const progressInterval = simulateAnalysisProgress();
      
      // Call the API to analyze the video
      const response = await fetch("/api/skyscraper/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          userId: "00000000-0000-0000-0000-000000000000" // Default user ID, replace with actual auth
        }),
      });
      
      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze video");
      }
      
      // Update the success status
      setProcessStatus({ 
        status: 'success', 
        message: 'Video analyzed successfully!',
        videoId: data.videoId,
        analysisPhase: 5, // All phases complete
        progress: 100,
        step: 'analyzing-pattern'
      });
      
      // Refresh the video list to show updated analysis status
      fetchVideos();
      
    } catch (error) {
      setProcessStatus({ 
        status: 'error', 
        message: error instanceof Error ? error.message : "An unknown error occurred" 
      });
    }
  };
  
  // Helper function to get the phase title
  const getPhaseTitle = (phase: number): string => {
    const titles = [
      'Initial Discovery & Structure',
      'Audience Response & Engagement',
      'Performance Analysis & Strategy',
      'Actionable Implementation Plan',
      'Pattern Repository Entry'
    ];
    return titles[phase - 1] || '';
  };
  
  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Vector Database</h1>
        </div>
        <Link href="/database/search">
          <Button variant="outline" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Semantic Search
          </Button>
        </Link>
      </div>
      
      <Tabs defaultValue="import" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="import">Import Videos</TabsTrigger>
          <TabsTrigger value="manage">Manage Database</TabsTrigger>
        </TabsList>
        
        <TabsContent value="import">
          <Card className="p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Import YouTube Video</h2>
            <p className="text-sm text-gray-600 mb-4">
              Enter a YouTube URL to process and add to the vector database. The video's transcript, 
              comments, and metadata will be processed and stored as embeddings.
            </p>
            
            <div className="flex gap-2 mb-4">
              <Input
                placeholder="Enter YouTube URL (e.g., https://www.youtube.com/watch?v=...)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={processStatus.status === 'processing'}
                className="flex-grow"
              />
              <Button 
                onClick={processVideo} 
                disabled={!url.trim() || processStatus.status === 'processing'}
              >
                {processStatus.status === 'processing' ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Video className="mr-2 h-4 w-4" />
                )}
                Process Video
              </Button>
            </div>
            
            <div className="flex items-center gap-4 mb-4">
              <div className="text-sm font-medium">Chunking Method:</div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="standard"
                  name="chunkingMethod"
                  value="standard"
                  checked={chunkingMethod === "standard"}
                  onChange={() => setChunkingMethod("standard")}
                  className="h-4 w-4"
                />
                <label htmlFor="standard" className="text-sm cursor-pointer">Standard</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="enhanced"
                  name="chunkingMethod"
                  value="enhanced"
                  checked={chunkingMethod === "enhanced"}
                  onChange={() => setChunkingMethod("enhanced")}
                  className="h-4 w-4"
                />
                <label htmlFor="enhanced" className="text-sm cursor-pointer">Enhanced</label>
              </div>
            </div>
            
            {processStatus.status !== 'idle' && (
              <div className={`rounded-lg shadow-sm p-5 mt-6 border ${
                processStatus.status === 'processing' ? 'border-blue-200 bg-blue-50/50' :
                processStatus.status === 'success' ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50'
              }`}>
                {processStatus.status === 'processing' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-blue-800">
                          {processStatus.step === 'downloading' && 'Downloading video...'}
                          {processStatus.step === 'transcribing' && 'Transcribing content...'}
                          {processStatus.step === 'processing' && 'Processing content...'}
                          {processStatus.step === 'vectorizing' && 'Creating vector embeddings...'}
                          {processStatus.step === 'storing' && 'Storing in database...'}
                          {processStatus.step === 'analyzing-structure' && 'Analyzing video structure...'}
                          {processStatus.step === 'analyzing-audience' && 'Analyzing audience response...'}
                          {processStatus.step === 'analyzing-performance' && 'Analyzing performance strategy...'}
                          {processStatus.step === 'analyzing-implementation' && 'Creating implementation plan...'}
                          {processStatus.step === 'analyzing-pattern' && 'Extracting pattern data...'}
                          {!processStatus.step && 'Processing video...'}
                        </h3>
                        <p className="text-sm text-blue-600 mt-1">{processStatus.message}</p>
                      </div>
                      <div className="animate-pulse">
                        <div className="h-2 w-2 bg-blue-500 rounded-full"></div>
                      </div>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-blue-700">
                        <span>Progress</span>
                        <span>{processStatus.progress ? `${processStatus.progress}%` : 'Processing...'}</span>
                      </div>
                      <div className="w-full bg-blue-100 rounded-full h-2.5 overflow-hidden">
                        <div 
                          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out"
                          style={{ width: `${processStatus.progress || 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {processStatus.step?.includes('analyzing') ? (
                        // Analysis progress steps
                        <>
                          <div className="grid grid-cols-5 gap-1 pt-1">
                            <div className={`h-1.5 rounded-l-full ${processStatus.analysisPhase && processStatus.analysisPhase >= 1 ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 ${processStatus.analysisPhase && processStatus.analysisPhase >= 2 ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 ${processStatus.analysisPhase && processStatus.analysisPhase >= 3 ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 ${processStatus.analysisPhase && processStatus.analysisPhase >= 4 ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 rounded-r-full ${processStatus.analysisPhase && processStatus.analysisPhase >= 5 ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                          </div>
                          
                          <div className="grid grid-cols-5 gap-1 text-xs text-center text-blue-600">
                            <div>Structure</div>
                            <div>Audience</div>
                            <div>Performance</div>
                            <div>Implementation</div>
                            <div>Pattern</div>
                          </div>
                        </>
                      ) : (
                        // Standard video processing steps
                        <>
                          <div className="grid grid-cols-5 gap-1 pt-1">
                            <div className={`h-1.5 rounded-l-full ${processStatus.step === 'downloading' || processStatus.step === 'transcribing' || processStatus.step === 'processing' || processStatus.step === 'vectorizing' || processStatus.step === 'storing' ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 ${processStatus.step === 'transcribing' || processStatus.step === 'processing' || processStatus.step === 'vectorizing' || processStatus.step === 'storing' ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 ${processStatus.step === 'processing' || processStatus.step === 'vectorizing' || processStatus.step === 'storing' ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 ${processStatus.step === 'vectorizing' || processStatus.step === 'storing' ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                            <div className={`h-1.5 rounded-r-full ${processStatus.step === 'storing' ? 'bg-blue-500' : 'bg-blue-200'}`}></div>
                          </div>
                          
                          <div className="grid grid-cols-5 gap-1 text-xs text-center text-blue-600">
                            <div>Download</div>
                            <div>Transcribe</div>
                            <div>Process</div>
                            <div>Vectorize</div>
                            <div>Store</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
                
                {processStatus.status === 'success' && (
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-green-100 p-2 mt-0.5">
                      <svg className="h-5 w-5 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-medium text-green-800">{processStatus.message}</h3>
                      <div className="text-sm text-green-600 mt-1">
                        <p>Video ID: <span className="font-mono bg-green-100/50 px-1 rounded">{processStatus.videoId}</span></p>
                        {processStatus.alreadyExists && processStatus.title && (
                          <p className="mt-1">Title: <span className="font-medium">{processStatus.title}</span></p>
                        )}
                        <p className="mt-1">Total chunks: <span className="font-mono bg-green-100/50 px-1 rounded">{processStatus.totalChunks}</span></p>
                        {processStatus.alreadyExists && (
                          <p className="mt-2 italic text-gray-600">This video was already in your database. No new processing was performed.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                
                {processStatus.status === 'error' && (
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-red-100 p-2 mt-0.5">
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-red-800">Processing Failed</h3>
                      <p className="text-sm text-red-600 mt-1">{processStatus.message}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Processed Videos</h2>
              <Button variant="outline" onClick={fetchVideos} disabled={isLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            
            {isLoading ? (
              <div className="text-center py-8">
                <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500">Loading videos...</p>
              </div>
            ) : videos.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-md">
                <Database className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500 mb-2">No videos processed yet</p>
                <p className="text-sm text-gray-400">Process a YouTube video to see it here</p>
              </div>
            ) : (
              <div className="divide-y">
                {videos.map(video => (
                  <div key={video.id} className="py-4 flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">{video.title}</h3>
                      <p className="text-sm text-gray-500">
                        Channel: {video.channelTitle} • {video.totalChunks} chunks
                        {video.analysisPhases ? ` • ${video.analysisPhases}/5 analyses` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => analyzeVideo(video.id)}
                        disabled={processStatus.status === 'processing'}
                      >
                        {video.analysisPhases === 5 ? (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Re-analyze
                          </>
                        ) : (
                          <>
                            <Video className="h-4 w-4 mr-2" />
                            {video.analysisPhases ? 'Continue Analysis' : 'Analyze'}
                          </>
                        )}
                      </Button>
                      <Link href={`/database/search?videoId=${video.id}`}>
                        <Button variant="outline" size="sm">
                          <Search className="h-4 w-4 mr-2" />
                          Search
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
        
        <TabsContent value="manage">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Vector Database Statistics</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 border rounded-md">
                <p className="text-sm text-gray-500">Total Videos</p>
                <p className="text-2xl font-semibold">{videos.length}</p>
              </div>
              
              <div className="p-4 border rounded-md">
                <p className="text-sm text-gray-500">Total Chunks</p>
                <p className="text-2xl font-semibold">
                  {videos.reduce((sum, video) => sum + (video.totalChunks || 0), 0)}
                </p>
              </div>
              
              <div className="p-4 border rounded-md">
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="text-2xl font-semibold">
                  {videos.length > 0 
                    ? new Date(Math.max(...videos.map(v => new Date(v.processingDate).getTime())))
                        .toLocaleDateString()
                    : "N/A"}
                </p>
              </div>
            </div>
            
            <div className="flex gap-4">
              <Button variant="outline" className="flex-1" onClick={fetchVideos}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Data
              </Button>
              
              <Button variant="destructive" className="flex-1" disabled>
                Reset Database
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
} 