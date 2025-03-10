"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Database, Search, Video, RefreshCw, AlertCircle, FileDown, Trash2, Check } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import Link from "next/link";
import { toast } from "@/components/ui/use-toast";
import SkyscraperDebugModal from '../components/SkyscraperDebugModal';
import { extractYouTubeId } from "@/lib/utils";
import { Label } from "@/components/ui/label";

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
  commentCount?: number;
  transcriptLength?: number;
  wordCount?: number;
}

interface ProcessStatus {
  status: 'idle' | 'processing' | 'success' | 'error';
  message: string;
  progress: number;
  error?: string;
  videoTitle?: string;
  alreadyExists?: boolean;
  title?: string;
  channelTitle?: string;
  transcriptLength?: number;
  commentCount?: number;
  commentGroups?: any;
  step?: number | string; // Allow both number and string for step
  isOpen: boolean;
  wordCount?: number;
  showCommentGroups?: boolean;
  totalChunks?: number;
}

// Types for debug data
interface DebugData {
  status: 'loading' | 'success' | 'error';
  videoId: string;
  videoTitle?: string;
  transcriptLength?: number;
  commentCount?: number;
  systemPrompt?: string;
  userPrompt?: string;
  analysisResults?: any;
  error?: string;
}

// Add this after the ProcessStatus interface
interface ReprocessStatus {
  isOpen: boolean;
  videoId: string;
  videoTitle: string;
  status: 'processing' | 'success' | 'error';
  message: string;
  progress: number;
  step?: 'downloading' | 'transcribing' | 'processing' | 'semantic-grouping' | 'vectorizing' | 'storing';
  wordCount?: number;
  commentCount?: number;
  commentGroups?: Array<{
    keywords: string[];
    commentCount: number;
    representativeComments: string[];
  }>;
  showCommentGroups?: boolean;
  totalChunks?: number;
}

export default function DatabasePage() {
  const [url, setUrl] = useState("");
  const [processStatus, setProcessStatus] = useState<ProcessStatus>({ 
    status: 'idle', 
    message: '', 
    progress: 0,
    isOpen: false
  });
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [chunkingMethod, setChunkingMethod] = useState<string>('enhanced');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugData>({
    status: 'loading',
    videoId: '',
  });
  
  // Add state for delete confirmations
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
  
  // Add this new state for reprocess modal
  const [reprocessStatus, setReprocessStatus] = useState<ReprocessStatus>({
    isOpen: false,
    videoId: '',
    videoTitle: '',
    status: 'processing',
    message: '',
    progress: 0,
  });
  
  // Define the steps array at the component level so it can be used in both the simulation and the UI
  const processingSteps = [
    { name: 'downloading', label: 'Download', message: 'Downloading video metadata...' },
    { name: 'transcribing', label: 'Transcribe', message: 'Transcribing video content...' },
    { name: 'processing', label: 'Process', message: 'Processing content...' },
    { name: 'semantic-grouping', label: 'Group', message: 'Semantically grouping comments with OpenAI embeddings...' },
    { name: 'vectorizing', label: 'Vectorize', message: 'Generating vector embeddings...' },
    { name: 'storing', label: 'Store', message: 'Storing in vector database...' }
  ];
  
  // Add activeTab state
  const [activeTab, setActiveTab] = useState("import");
  
  // Fetch existing videos when the page loads
  useEffect(() => {
    fetchVideos();
  }, []);
  
  // Function to fetch processed videos from the database
  const fetchVideos = async () => {
    try {
      setIsLoading(true);
      
      // You'll need to create this API endpoint
      const response = await fetch("/api/vector/videos?userId=00000000-0000-0000-0000-000000000000", {
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
      // Get the video ID from the URL
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        throw new Error("Invalid YouTube URL");
      }
      
      // Open the modal and initialize status
      setProcessStatus({
        isOpen: true,
        status: 'processing',
        message: processingSteps[0].message,
        progress: 5,
        step: 1 // Use number for step
      });

      // Set up progress simulation
      const simulateProgress = () => {
        let currentStep = 0;
        let progress = 5;
        
        const interval = setInterval(() => {
          // Calculate how much progress to add based on current step
          // Different steps take different amounts of time in reality
          let progressIncrement = 4;
          if (processingSteps[currentStep].name === 'semantic-grouping' || processingSteps[currentStep].name === 'vectorizing') {
            progressIncrement = 6; // These steps take longer
          } else if (processingSteps[currentStep].name === 'downloading') {
            progressIncrement = 3; // This step is usually quick
          }
          
          progress += progressIncrement;
          
          // Determine if we should move to the next step
          // We want to spend more time on the steps that actually take longer
          if (progress >= 95) {
            clearInterval(interval);
            progress = 95; // Cap at 95%, will go to 100% when complete
          } else if (
            (currentStep === 0 && progress >= 15) || // downloading: short
            (currentStep === 1 && progress >= 30) || // transcribing: medium
            (currentStep === 2 && progress >= 45) || // processing: medium
            (currentStep === 3 && progress >= 65) || // semantic-grouping: longer
            (currentStep === 4 && progress >= 85)    // vectorizing: longer
          ) {
            if (currentStep < processingSteps.length - 1) {
              currentStep++;
            }
          }
          
          setProcessStatus(prev => ({
            ...prev,
            step: currentStep + 1, // Use number for step (1-indexed)
            progress,
            message: processingSteps[currentStep].message
          }));
          
        }, 500);
        
        return interval;
      };
      
      const progressInterval = simulateProgress();
      
      // Call the process endpoint
      const response = await fetch("/api/vector/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: url,
          userId: "00000000-0000-0000-0000-000000000000", // Default user ID, replace with actual auth
          chunkingMethod: chunkingMethod, // Use the selected chunking method
          commentLimit: 500 // Increase comment limit for better results
        }),
      });
      
      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to process video");
      }
      
      // Fetch comment groups for display
      let commentGroups = [];
      try {
        // Get comment clusters from the chunks
        if (data.chunks) {
          commentGroups = data.chunks
            .filter((chunk: any) => chunk.contentType === 'comment_cluster')
            .map((chunk: any) => ({
              topic: chunk.metadata?.keywords?.join(', ') || 'Comment Group',
              count: chunk.metadata?.commentCount || 0
            }));
        }
      } catch (error) {
        console.error("Error extracting comment groups:", error);
      }
      
      // Update modal with success and include the new statistics
      setProcessStatus(prev => ({
        ...prev,
        status: 'success',
        progress: 100,
        message: data.alreadyExists 
          ? 'Video already exists in database' 
          : 'Successfully processed video with enhanced comment grouping',
        step: 5, // Use number for step
        videoTitle: data.title || data.videoTitle || 'Unknown Title',
        channelTitle: data.channelTitle || 'Unknown Channel',
        wordCount: data.wordCount || Math.round((data.transcriptLength || 0) / 5), // Estimate words from characters if needed
        commentCount: data.commentCount || 0,
        commentGroups: commentGroups,
        totalChunks: data.totalChunks || 0
      }));
      
      // Clear the URL input
      setUrl("");
      
      // Show a toast notification
      toast({
        title: data.alreadyExists ? "Video Already Exists" : "Video Processed",
        description: data.alreadyExists
          ? `The video already exists in the database with ${data.commentCount?.toLocaleString() || 0} comments`
          : `Successfully processed video with ${data.commentCount?.toLocaleString() || 0} comments in ${commentGroups.length} enhanced groups`,
      });
      
      // Refresh the video list
      await fetchVideos();
    } catch (error) {
      console.error("Error processing video:", error);
      
      // Update modal with error
      setProcessStatus(prev => ({
        ...prev,
        status: 'error',
        progress: prev.progress,
        message: error instanceof Error ? error.message : "Failed to process video",
        isOpen: true
      }));
      
      toast({
        title: "Processing Failed",
        description: error instanceof Error ? error.message : "Failed to process video",
        variant: "destructive",
      });
    }
  };
  
  // Analyze a processed video with Skyscraper method
  const analyzeVideo = async (videoId: string) => {
    // Initialize debug data
    setDebugData({
      status: 'loading',
      videoId,
      videoTitle: videos.find(v => v.id === videoId)?.title,
      transcriptLength: videos.find(v => v.id === videoId)?.transcriptLength,
      commentCount: videos.find(v => v.id === videoId)?.commentCount,
      systemPrompt: "You are an expert video content analyzer. Your task is to analyze the video's transcript and comments to extract insights about its structure, audience engagement, and success factors.",
      userPrompt: "Please analyze this video content using the Skyscraper Analysis Framework to understand its structure, audience response, and key success factors.",
    });
    
    // Update process status
    setProcessStatus(prev => ({
      ...prev,
      status: 'processing',
      progress: 0,
      message: 'Starting analysis...',
      isOpen: true
    }));

    // Show the debug modal without starting analysis
    setDebugModalOpen(true);
  };
  
  // Update the startAnalysis function
  const startAnalysis = async () => {
    try {
      const videoId = debugData.videoId;
      
      // Update UI to show processing
      setProcessStatus({ 
        status: 'processing', 
        message: 'Starting video analysis...',
        step: 1,
        progress: 5,
        isOpen: true
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
      
      // Call the API to analyze the video with Claude
      const response = await fetch("/api/skyscraper/analyze-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          userId: "00000000-0000-0000-0000-000000000000"
        }),
      });
      
      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to analyze video");
      }
      
      // Update debug data with the results
      setDebugData((prev: DebugData) => ({
        ...prev,
        status: 'success',
        systemPrompt: data.systemPrompt,
        userPrompt: data.userPrompt,
        analysisResults: data.analysisResults,
      }));
      
      // Update the success status
      setProcessStatus({
        status: 'success',
        message: 'Video analyzed successfully with Claude!',
        step: 'analyzing-pattern',
        progress: 100,
        isOpen: true
      });
      
      toast({
        title: "Analysis Complete",
        description: "Claude has analyzed the video content successfully.",
      });
      
      // Refresh the video list
      fetchVideos();
      
    } catch (error) {
      console.error("Error analyzing video:", error);
      
      // Update modal with error
      setProcessStatus({
        status: 'error',
        message: error instanceof Error ? error.message : "Failed to analyze video",
        progress: 0,
        isOpen: true
      });
      
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
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
  
  // Add this new function to handle downloads
  const downloadTranscript = async (videoId: string, title: string) => {
    try {
      toast({
        title: "Preparing Download",
        description: "Retrieving transcript and comments...",
      });
      
      const response = await fetch(`/api/vector/download-transcript?videoId=${videoId}`, {
        method: "GET",
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch transcript");
      }
      
      if (!data.transcript && !data.comments) {
        throw new Error("No content available for this video");
      }
      
      // Create markdown content
      let markdown = `# ${title}\n\n`;
      
      // Calculate word counts for feedback
      const transcriptWordCount = data.transcript ? data.transcript.split(/\s+/).length : 0;
      const commentsWordCount = data.comments ? data.comments.split(/\s+/).length : 0;
      
      if (data.transcript) {
        markdown += `## Transcript (${transcriptWordCount.toLocaleString()} words)\n\n${data.transcript}\n\n`;
      }
      
      if (data.comments) {
        // Check if the comments contain comment clusters
        const hasCommentClusters = data.comments.includes('### Comment Group');
        
        if (hasCommentClusters) {
          markdown += `## Comment Groups (Semantically Clustered, ${commentsWordCount.toLocaleString()} words)\n\n`;
          markdown += `*These comments have been semantically grouped using OpenAI embeddings*\n\n`;
        } else {
          markdown += `## Comments (${commentsWordCount.toLocaleString()} words)\n\n`;
        }
        
        markdown += `${data.comments}\n`;
      }
      
      // Create and trigger download
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}-transcript.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      const totalWordCount = transcriptWordCount + commentsWordCount;
      
      toast({
        title: "Download Complete",
        description: `Downloaded ${totalWordCount.toLocaleString()} words (${transcriptWordCount.toLocaleString()} transcript, ${commentsWordCount.toLocaleString()} comments)`,
      });
      
    } catch (error) {
      console.error("Error downloading transcript:", error);
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download transcript",
        variant: "destructive",
      });
    }
  };
  
  // Function to handle saving analysis results to database
  const handleSaveAnalysis = async () => {
    try {
      // TODO: Implement database save functionality
      toast({
        title: "Not Implemented",
        description: "Database save functionality will be implemented in the next step.",
      });
    } catch (error) {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : "Failed to save analysis results",
        variant: "destructive",
      });
    }
  };
  
  // Add these new functions for selection and deletion
  const toggleVideoSelection = (videoId: string) => {
    setSelectedVideos(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(videoId)) {
        newSelection.delete(videoId);
      } else {
        newSelection.add(videoId);
      }
      return newSelection;
    });
  };

  const toggleAllVideos = () => {
    setSelectedVideos(prev => {
      if (prev.size === videos.length) {
        return new Set();
      }
      return new Set(videos.map(v => v.id));
    });
  };

  // Updated delete functions with confirmation handling
  const handleDeleteClick = (videoId: string) => {
    setVideoToDelete(videoId);
    setShowDeleteConfirm(true);
  };

  const handleBatchDeleteClick = () => {
    setShowBatchDeleteConfirm(true);
  };

  const deleteSelectedVideos = async () => {
    try {
      setIsLoading(true);
      console.log('Deleting selected videos:', Array.from(selectedVideos));
      
      const response = await fetch("/api/vector/delete-videos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: Array.from(selectedVideos)
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Delete API error:', data);
        throw new Error(data.error || "Failed to delete videos");
      }

      toast({
        title: "Videos Deleted",
        description: `Successfully deleted ${selectedVideos.size} video${selectedVideos.size === 1 ? '' : 's'}`,
      });

      setSelectedVideos(new Set());
      await fetchVideos();
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete videos",
        variant: "destructive",
      });
    } finally {
      setShowBatchDeleteConfirm(false);
      setIsLoading(false);
    }
  };

  const deleteVideo = async (videoId: string) => {
    if (!videoId) return;
    
    try {
      setIsLoading(true);
      console.log('Deleting video:', videoId);
      
      const response = await fetch(`/api/vector/delete-videos`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: [videoId]
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Delete API error:', data);
        throw new Error(data.error || "Failed to delete video");
      }

      toast({
        title: "Video Deleted",
        description: data.message || "Successfully deleted the video",
      });

      await fetchVideos();
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete video",
        variant: "destructive",
      });
    } finally {
      setShowDeleteConfirm(false);
      setVideoToDelete(null);
      setIsLoading(false);
    }
  };
  
  // Update the reprocessVideo function
  const reprocessVideo = async (videoId: string) => {
    try {
      // First get the video URL
      const video = videos.find(v => v.id === videoId);
      if (!video) {
        throw new Error("Video not found");
      }

      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      
      // Open the modal and initialize status
      setReprocessStatus({
        isOpen: true,
        videoId,
        videoTitle: video.title,
        status: 'processing',
        message: processingSteps[0].message,
        progress: 5,
        step: processingSteps[0].name as ReprocessStatus['step'],
        showCommentGroups: false,
        totalChunks: video.totalChunks
      });

      // Set up progress simulation
      const simulateProgress = () => {
        let currentStep = 0;
        let progress = 5;
        
        const interval = setInterval(() => {
          // Calculate how much progress to add based on current step
          // Different steps take different amounts of time in reality
          let progressIncrement = 4;
          if (processingSteps[currentStep].name === 'semantic-grouping' || processingSteps[currentStep].name === 'vectorizing') {
            progressIncrement = 6; // These steps take longer
          } else if (processingSteps[currentStep].name === 'downloading') {
            progressIncrement = 3; // This step is usually quick
          }
          
          progress += progressIncrement;
          
          // Determine if we should move to the next step
          // We want to spend more time on the steps that actually take longer
          if (progress >= 95) {
            clearInterval(interval);
            progress = 95; // Cap at 95%, will go to 100% when complete
          } else if (
            (currentStep === 0 && progress >= 15) || // downloading: short
            (currentStep === 1 && progress >= 30) || // transcribing: medium
            (currentStep === 2 && progress >= 45) || // processing: medium
            (currentStep === 3 && progress >= 65) || // semantic-grouping: longer
            (currentStep === 4 && progress >= 85)    // vectorizing: longer
          ) {
            if (currentStep < processingSteps.length - 1) {
              currentStep++;
            }
          }
          
          setReprocessStatus(prev => ({
            ...prev,
            step: processingSteps[currentStep].name as ReprocessStatus['step'],
            progress,
            message: processingSteps[currentStep].message
          }));
          
        }, 500);
        
        return interval;
      };

      const progressInterval = simulateProgress();
      
      // Call the process endpoint with reprocess flag
      const response = await fetch("/api/vector/process-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          userId: "00000000-0000-0000-0000-000000000000",
          chunkingMethod: "enhanced",
          reprocess: true,
          commentLimit: 500 // Increase comment limit for reprocessing
        }),
      });
      
      clearInterval(progressInterval);
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Failed to reprocess video");
      }
      
      // Fetch comment groups for display
      let commentGroups = [];
      try {
        // Get comment clusters from the chunks
        if (data.chunks) {
          commentGroups = data.chunks
            .filter((chunk: any) => chunk.contentType === 'comment_cluster')
            .map((chunk: any) => ({
              keywords: chunk.metadata?.keywords || [],
              commentCount: chunk.metadata?.commentCount || 0,
              representativeComments: chunk.metadata?.representativeComments || 
                [chunk.content.split('\n\n').slice(0, 2).join('\n\n')]
            }));
        }
      } catch (error) {
        console.error("Error extracting comment groups:", error);
      }
      
      // Update modal with success and include the new statistics
      setReprocessStatus(prev => ({
        ...prev,
        status: 'success',
        progress: 100,
        message: 'Successfully reprocessed video content with semantic comment grouping',
        step: 'storing',
        wordCount: data.wordCount || 0,
        commentCount: data.commentCount || 0,
        commentGroups: commentGroups,
        totalChunks: data.totalChunks || 0
      }));
      
      toast({
        title: "Video Reprocessed",
        description: `Successfully reprocessed video with ${data.commentCount?.toLocaleString() || 0} comments in ${commentGroups.length} semantic groups`,
      });
      
      // Refresh the video list to get updated data
      await fetchVideos();
    } catch (error) {
      console.error("Error reprocessing video:", error);
      
      // Update modal with error
      setReprocessStatus(prev => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : "Failed to reprocess video"
      }));
      
      toast({
        title: "Reprocess Failed",
        description: error instanceof Error ? error.message : "Failed to reprocess video",
        variant: "destructive",
      });
    }
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
          <Card className="p-6 bg-gray-900 border-gray-800 text-white">
            <CardHeader>
              <CardTitle>Import YouTube Video</CardTitle>
              <CardDescription>
                Process a YouTube video to extract transcript and comments for analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="url">YouTube URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="url"
                      placeholder="https://www.youtube.com/watch?v=..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="flex-1 bg-gray-800 border-gray-700 text-white"
                    />
                    <Button 
                      onClick={processVideo} 
                      disabled={!url.trim() || isLoading}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                          Processing
                        </>
                      ) : (
                        <>
                          <Video className="mr-2 h-4 w-4" />
                          Process Video
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Chunking Method</Label>
                  <div className="flex flex-col space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="standard"
                        value="standard"
                        checked={chunkingMethod === 'standard'}
                        onChange={() => setChunkingMethod('standard')}
                        className="h-4 w-4 text-blue-600"
                      />
                      <Label htmlFor="standard" className="cursor-pointer">Standard</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="enhanced"
                        value="enhanced"
                        checked={chunkingMethod === 'enhanced'}
                        onChange={() => setChunkingMethod('enhanced')}
                        className="h-4 w-4 text-blue-600"
                      />
                      <Label htmlFor="enhanced" className="cursor-pointer">Enhanced (Semantic Grouping)</Label>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="manage">
          <Card className="p-6 bg-gray-900 border-gray-800 text-white">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Processed Videos</h2>
              <Button 
                variant="outline" 
                onClick={fetchVideos} 
                disabled={isLoading}
                className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 hover:text-white"
              >
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
              <div className="text-center py-12 border border-dashed border-gray-700 rounded-md">
                <Database className="h-12 w-12 mx-auto mb-4 text-gray-600" />
                <p className="text-gray-400 mb-2">No videos processed yet</p>
                <p className="text-sm text-gray-500">Process a YouTube video to see it here</p>
              </div>
            ) : (
              <>
                {selectedVideos.size > 0 && (
                  <div className="bg-gray-800 border-b border-gray-700 py-3 px-4 flex items-center justify-between sticky top-0 z-10">
                    <div className="flex items-center">
                      <Checkbox
                        checked={selectedVideos.size === videos.length}
                        onClick={toggleAllVideos}
                        className="mr-3"
                      />
                      <span className="text-sm font-medium text-gray-200">
                        {selectedVideos.size} selected
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBatchDeleteClick}
                      className="flex items-center"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Selected
                    </Button>
                  </div>
                )}
                <div className="divide-y divide-gray-800">
                  {videos.map(video => (
                    <div key={video.id} className="py-4 flex items-center hover:bg-gray-800/50">
                      <div className="flex-shrink-0 pr-4">
                        <Checkbox
                          checked={selectedVideos.has(video.id)}
                          onClick={() => toggleVideoSelection(video.id)}
                        />
                      </div>
                      <div className="flex-grow">
                        <div className="flex items-center">
                          <h3 className="font-medium text-white mr-2">{video.title}</h3>
                          <a 
                            href={`https://www.youtube.com/watch?v=${video.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-400 flex-shrink-0"
                            title="Watch on YouTube"
                          >
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                            </svg>
                          </a>
                        </div>
                        <div className="flex items-center text-sm text-gray-400 flex-wrap mt-1">
                          <span className="text-gray-500">Channel: </span>
                          <span className="text-gray-300 ml-1">{video.channelTitle}</span>
                          <span className="mx-2">•</span>
                          <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                            <span>{video.commentCount?.toLocaleString() || 0} comments</span>
                          </div>
                          <span className="mx-2">•</span>
                          <span>{video.wordCount ? `${video.wordCount.toLocaleString()} words` : (video.transcriptLength ? `${Math.round(video.transcriptLength / 5).toLocaleString()} words` : '0 words')}</span>
                          <span className="mx-2">•</span>
                          <span>{video.totalChunks || 0} chunks</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => downloadTranscript(video.id, video.title)}
                          className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 hover:text-white"
                        >
                          <FileDown className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => analyzeVideo(video.id)}
                          disabled={isLoading}
                          className="bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700 hover:text-white"
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClick(video.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => reprocessVideo(video.id)}
                          disabled={isLoading}
                          className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      
      <SkyscraperDebugModal
        isOpen={debugModalOpen}
        onClose={() => setDebugModalOpen(false)}
        debugData={debugData}
        onSaveAnalysis={handleSaveAnalysis}
        onStartAnalysis={startAnalysis}
      />
      
      {/* Add Alert Dialogs */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the video
              and its associated data from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => videoToDelete && deleteVideo(videoToDelete)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showBatchDeleteConfirm} onOpenChange={setShowBatchDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete {selectedVideos.size} selected 
              video{selectedVideos.size === 1 ? '' : 's'} and their associated data from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelectedVideos}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete {selectedVideos.size} video{selectedVideos.size === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Add Reprocess Modal */}
      <AlertDialog open={reprocessStatus.isOpen} onOpenChange={(open) => !open && setReprocessStatus(prev => ({ ...prev, isOpen: false }))}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-semibold">
              {reprocessStatus.status === 'processing' ? 'Reprocessing Video...' :
               reprocessStatus.status === 'success' ? 'Reprocess Complete' : 'Reprocess Failed'}
            </AlertDialogTitle>
            <div className="mt-1">
              <p className="text-base font-medium text-muted-foreground">{reprocessStatus.videoTitle}</p>
            </div>
          </AlertDialogHeader>
          
          <div className="py-2">
            {reprocessStatus.status === 'processing' && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{reprocessStatus.message}</span>
                    <span className="font-medium">{reprocessStatus.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${reprocessStatus.progress}%` }}
                    />
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="grid grid-cols-6 gap-1">
                    {processingSteps.map((step, index) => (
                      <div 
                        key={index} 
                        className={`h-1.5 ${index === 0 ? 'rounded-l-full' : ''} ${index === processingSteps.length - 1 ? 'rounded-r-full' : ''} ${
                          processingSteps.slice(0, processingSteps.findIndex(s => s.name === reprocessStatus.step) + 1).some(s => s.name === step.name) 
                            ? 'bg-blue-500' 
                            : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                      />
                    ))}
                  </div>
                  
                  <div className="grid grid-cols-6 gap-1 text-xs text-center text-muted-foreground">
                    {processingSteps.map((step, index) => (
                      <div key={index}>{step.label}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            {reprocessStatus.status === 'success' && (
              <div className="space-y-6">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
                  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="font-medium">{reprocessStatus.message}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Word Count</div>
                    <div className="text-2xl font-semibold text-gray-900 dark:text-white">{reprocessStatus.wordCount?.toLocaleString() || '0'}</div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Comments</div>
                    <div className="text-2xl font-semibold text-gray-900 dark:text-white">
                      {reprocessStatus.commentCount?.toLocaleString() || '0'}
                    </div>
                    {reprocessStatus.commentGroups && reprocessStatus.commentGroups.length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Grouped into {reprocessStatus.commentGroups.length} semantic clusters
                      </div>
                    )}
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Chunks</div>
                    <div className="text-2xl font-semibold text-gray-900 dark:text-white">{reprocessStatus.totalChunks || '0'}</div>
                  </div>
                </div>
                
                {reprocessStatus.commentGroups && reprocessStatus.commentGroups.length > 0 && (
                  <div className="mt-2">
                    <Button 
                      variant="outline" 
                      className="w-full flex items-center justify-center gap-2 text-sm font-medium h-10"
                      onClick={() => setReprocessStatus(prev => ({ ...prev, showCommentGroups: !prev.showCommentGroups }))}
                    >
                      {reprocessStatus.showCommentGroups ? (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                          </svg>
                          Hide Comment Groups
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                          View Semantic Comment Groups
                        </>
                      )}
                    </Button>
                    
                    {reprocessStatus.showCommentGroups && (
                      <div className="mt-4 space-y-1">
                        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-t-md border border-gray-200 dark:border-gray-700">
                          <div className="flex items-center">
                            <span className="text-sm font-medium">{reprocessStatus.commentGroups.length}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400 ml-1.5">Semantic Comment Groups</span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Powered by OpenAI embeddings
                          </div>
                        </div>
                        
                        <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-b-md divide-y divide-gray-200 dark:divide-gray-700 dark:border-gray-700 bg-white dark:bg-gray-900">
                          {reprocessStatus.commentGroups.map((group, index) => (
                            <div key={index} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                              <div className="flex justify-between items-start mb-3">
                                <div className="flex flex-wrap gap-1.5 max-w-[85%]">
                                  {group.keywords.map((keyword, kidx) => (
                                    <span key={kidx} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300">
                                      {keyword}
                                    </span>
                                  ))}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center whitespace-nowrap">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                  </svg>
                                  <span>{group.commentCount} {group.commentCount === 1 ? 'comment' : 'comments'}</span>
                                </div>
                              </div>
                              <div className="space-y-2.5">
                                {group.representativeComments.map((comment, cidx) => (
                                  <div key={cidx} className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md text-sm text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-700 relative">
                                    <div className="absolute -top-1 -left-1 w-2 h-2 bg-blue-500 rounded-full"></div>
                                    {comment.length > 150 ? comment.substring(0, 150) + '...' : comment}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {reprocessStatus.status === 'error' && (
              <div className="flex items-center gap-2 text-red-600 dark:text-red-500 mt-2">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">{reprocessStatus.message}</span>
              </div>
            )}
          </div>
          
          <AlertDialogFooter>
            <AlertDialogAction
              className="min-w-24"
              onClick={() => setReprocessStatus(prev => ({ ...prev, isOpen: false }))}
            >
              {reprocessStatus.status === 'processing' ? 'Close' : 'Done'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Process Modal */}
      <AlertDialog open={processStatus.isOpen} onOpenChange={(open) => !open && setProcessStatus(prev => ({ ...prev, isOpen: false }))}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {processStatus.status === 'success' ? 'Video Processed Successfully' : 
               processStatus.status === 'error' ? 'Processing Error' : 
               'Processing Video'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* Simple text description can go here if needed */}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {/* Move content outside of AlertDialogDescription */}
          {processStatus.status === 'processing' && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{processStatus.message}</span>
                <span className="text-sm font-medium">{Math.round(processStatus.progress)}%</span>
              </div>
              <Progress value={processStatus.progress} className="h-2" />
              
              <div className="mt-6 space-y-2">
                <div className="flex items-center">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center mr-3 ${Number(processStatus.step) >= 1 ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {Number(processStatus.step) >= 1 ? <Check className="h-3 w-3 text-white" /> : <span className="text-xs text-gray-600">1</span>}
                  </div>
                  <span className={Number(processStatus.step) >= 1 ? 'text-green-500' : ''}>Downloading video</span>
                </div>
                
                <div className="flex items-center">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center mr-3 ${Number(processStatus.step) >= 2 ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {Number(processStatus.step) >= 2 ? <Check className="h-3 w-3 text-white" /> : <span className="text-xs text-gray-600">2</span>}
                  </div>
                  <span className={Number(processStatus.step) >= 2 ? 'text-green-500' : ''}>Transcribing content</span>
                </div>
                
                <div className="flex items-center">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center mr-3 ${Number(processStatus.step) >= 3 ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {Number(processStatus.step) >= 3 ? <Check className="h-3 w-3 text-white" /> : <span className="text-xs text-gray-600">3</span>}
                  </div>
                  <span className={Number(processStatus.step) >= 3 ? 'text-green-500' : ''}>
                    {chunkingMethod === 'enhanced' ? 'Creating semantic groups' : 'Chunking content'}
                  </span>
                </div>
                
                <div className="flex items-center">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center mr-3 ${Number(processStatus.step) >= 4 ? 'bg-green-500' : 'bg-gray-300'}`}>
                    {Number(processStatus.step) >= 4 ? <Check className="h-3 w-3 text-white" /> : <span className="text-xs text-gray-600">4</span>}
                  </div>
                  <span className={Number(processStatus.step) >= 4 ? 'text-green-500' : ''}>Vectorizing content</span>
                </div>
              </div>
            </div>
          )}
          
          {processStatus.status === 'success' && (
            <div className="mt-4 space-y-4">
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-md">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Video Title</p>
                    <p className="font-medium">{processStatus.videoTitle}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Channel</p>
                    <p className="font-medium">{processStatus.channelTitle}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Transcript Length</p>
                    <p className="font-medium">{processStatus.wordCount ? `${processStatus.wordCount.toLocaleString()} words` : 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Comments Processed</p>
                    <p className="font-medium">{processStatus.commentCount?.toLocaleString() || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Chunks</p>
                    <p className="font-medium">{processStatus.totalChunks || 0}</p>
                  </div>
                </div>
              </div>
              
              {processStatus.commentGroups && processStatus.commentGroups.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Comment Groups</h3>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                    {processStatus.commentGroups.map((group: {topic: string, count: number}, index: number) => (
                      <div key={index} className="p-3 bg-gray-100 dark:bg-gray-800 rounded-md">
                        <p className="text-sm font-medium mb-1">{group.topic}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{group.count} comments</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {processStatus.status === 'error' && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 rounded-md">
              <p className="font-medium">Error: {processStatus.message}</p>
              {processStatus.message === 'Video already exists in database' && (
                <p className="mt-2 text-sm">This video has already been processed. You can find it in the "Manage" tab.</p>
              )}
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            {processStatus.status === 'success' && (
              <Button onClick={() => {
                setProcessStatus(prev => ({ ...prev, isOpen: false }));
                setActiveTab("manage");
              }}>
                View in Database
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
} 