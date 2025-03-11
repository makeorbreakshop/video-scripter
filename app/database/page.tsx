"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Database, 
  Search, 
  Video, 
  RefreshCw, 
  AlertCircle, 
  FileDown, 
  Trash2, 
  Check, 
  ExternalLink, 
  MoreVertical, 
  FileText, 
  ChevronDown,
  RefreshCcw, 
  DownloadCloud,
  Clipboard,
  CheckSquare
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { toast } from "@/components/ui/use-toast";
import SkyscraperDebugModal from '../components/SkyscraperDebugModal';
import { extractYouTubeId } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { analyzeVideoWithSkyscraper } from '@/app/actions/skyscraper-analysis';
import { CLAUDE_MODELS } from '@/app/constants/claude-models';
import { formatAnalysisMarkdown } from "@/app/utils/formatAnalysisMarkdown";

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
  hasSkyscraperAnalysis?: boolean;
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
  status: 'loading' | 'success' | 'error' | 'initial';
  videoId: string;
  videoTitle?: string;
  transcriptLength?: number;
  commentCount?: number;
  systemPrompt?: string;
  userPrompt?: string;
  analysisResults?: any;
  error?: string;
  reasoning?: string;
  modelId?: string;
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
    status: 'initial',
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
  
  // Ensure parsedStreamData is passed to DatabasePage
  const [parsedStreamData, setParsedStreamData] = useState<any>(null);
  
  // Add useRef import
  const debugModalRef = useRef<{streamedText: string} | null>(null);
  
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
    // Get video details
    const video = videos.find(v => v.id === videoId);
    
    // Create the full system prompt based on the Skyscraper Analysis Framework
    const fullSystemPrompt = `
You are an expert video content analyzer using the Skyscraper Analysis Framework. Your task is to analyze a YouTube video based on its transcript and comments.

The Skyscraper Analysis Framework consists of:

1. Content Analysis: Structure, key points, technical information, expertise elements, visual cues
2. Audience Analysis: Sentiment, praise points, questions/gaps, use cases, demographic signals, engagement patterns
3. Content Gap Assessment: Missing information, follow-up opportunities, clarity issues, depth/breadth balance
4. Framework Elements: Overall structure, section ratios, information hierarchy, pacing/flow
5. Engagement Techniques: Hook strategy, retention mechanisms, pattern interrupts, interaction prompts
6. Value Delivery Methods: Information packaging, problem-solution framing, practical application, trust building
7. Implementation Blueprint: Content template, key sections, engagement points, differentiation opportunities, CTA strategy

Provide a comprehensive analysis with specific, actionable insights. Format your response as a structured JSON object that matches the following schema:

{
  "content_analysis": {
    "structural_organization": [
      {"title": "Section Name", "start_time": "MM:SS", "end_time": "MM:SS", "description": "Brief description"}
    ],
    "key_points": [
      {"point": "Main point", "timestamp": "MM:SS", "elaboration": "Details about this point"}
    ],
    "technical_information": [
      {"topic": "Technical topic", "details": "Specific technical details mentioned"}
    ],
    "expertise_elements": "Analysis of how expertise is demonstrated",
    "visual_elements": [
      {"element": "Visual element", "purpose": "How it supports the content"}
    ]
  },
  "audience_analysis": {
    "sentiment_overview": {
      "positive": 0.7,
      "neutral": 0.2,
      "negative": 0.1,
      "key_themes": ["Theme 1", "Theme 2"]
    },
    "praise_points": [
      {"topic": "What viewers praised", "frequency": "high/medium/low", "examples": ["Example comment"]}
    ],
    "questions_gaps": [
      {"question": "Common question", "frequency": "high/medium/low", "context": "When/why this comes up"}
    ],
    "use_cases": [
      {"case": "How viewers use this information", "context": "Details about this use case"}
    ],
    "demographic_signals": {
      "expertise_level": "beginner/intermediate/advanced",
      "industry_focus": ["Industry 1", "Industry 2"],
      "notable_segments": ["Segment description"]
    },
    "engagement_patterns": [
      {"pattern": "Engagement pattern", "indicators": ["Indicator 1", "Indicator 2"]}
    ]
  },
  "content_gaps": {
    "missing_information": [
      {"topic": "Missing topic", "importance": "high/medium/low", "context": "Why this matters"}
    ],
    "follow_up_opportunities": "Analysis of potential follow-up content",
    "clarity_issues": "Areas where viewers expressed confusion",
    "depth_breadth_balance": "Assessment of content depth vs breadth"
  },
  "framework_elements": {
    "overall_structure": "Analysis of the video's structural approach",
    "section_ratios": {
      "introduction": 0.1,
      "main_content": 0.7,
      "conclusion": 0.2
    },
    "information_hierarchy": "How information is prioritized and organized",
    "pacing_flow": "Analysis of content pacing and transitions"
  },
  "engagement_techniques": {
    "hook_strategy": "Analysis of how the video hooks viewers",
    "retention_mechanisms": [
      {"technique": "Retention technique", "implementation": "How it's used", "effectiveness": "high/medium/low"}
    ],
    "pattern_interrupts": [
      {"type": "Type of pattern interrupt", "timestamp": "MM:SS", "purpose": "Why it's used here"}
    ],
    "interaction_prompts": [
      {"prompt_type": "Type of prompt", "implementation": "How it's presented"}
    ]
  },
  "value_delivery": {
    "information_packaging": "How information is structured for value",
    "problem_solution_framing": "How problems and solutions are presented",
    "practical_application": [
      {"application": "Practical use", "context": "How it's presented"}
    ],
    "trust_building": [
      {"element": "Trust element", "implementation": "How trust is built"}
    ]
  },
  "implementation_blueprint": {
    "content_template": "Template for similar content",
    "key_sections": [
      {"section": "Recommended section", "purpose": "Why include this", "content_guidance": "What to include"}
    ],
    "engagement_points": [
      {"point": "Engagement opportunity", "implementation": "How to implement"}
    ],
    "differentiation_opportunities": [
      {"opportunity": "Way to differentiate", "implementation": "How to implement"}
    ],
    "cta_strategy": "Call-to-action approach"
  }
}

Ensure your analysis is comprehensive, specific, and actionable. Focus on extracting patterns that can be applied to future content creation.
`;

    const fullUserPrompt = `Please analyze this video content using the Skyscraper Analysis Framework to understand its structure, audience response, and key success factors. The video has ${video?.transcriptLength?.toLocaleString()} characters of transcript content and ${video?.commentCount} comments to analyze.

Focus on:
1. Identifying the key structural elements and how they contribute to the video's effectiveness
2. Understanding audience engagement patterns and sentiment through comment analysis
3. Extracting actionable insights that can be applied to future content creation
4. Identifying content gaps and opportunities for follow-up content
5. Understanding the video's hook strategy and retention mechanisms
6. Analyzing how value is delivered and trust is built with the audience
7. Creating a practical implementation blueprint for similar content`;

    // Initialize debug data
    setDebugData({
      status: 'initial',
      videoId,
      videoTitle: video?.title,
      transcriptLength: video?.transcriptLength,
      commentCount: video?.commentCount,
      systemPrompt: fullSystemPrompt,
      userPrompt: fullUserPrompt,
    });
    
    // Show the debug modal without starting analysis
    setDebugModalOpen(true);
  };
  
  // Update the startAnalysis function
  const startAnalysis = async (modelId?: string) => {
    try {
      const videoId = debugData.videoId;
      
      // Update UI to show processing
      setProcessStatus({ 
        status: 'processing', 
        message: 'Starting video analysis...',
        step: 1,
        progress: 5,
        isOpen: false
      });

      // Update debug data to show loading state
      setDebugData(prev => ({
        ...prev,
        status: 'loading'
      }));

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

      // Start the interval for progress simulation
      const progressInterval = simulateAnalysisProgress();
      
      try {
        // Call the Server Action to analyze the video with Claude via AI SDK
        const result = await analyzeVideoWithSkyscraper(
          videoId,
          "00000000-0000-0000-0000-000000000000", // Default user ID
          modelId
        );
        
        // Update debug data with the results
        setDebugData((prev: DebugData) => ({
          ...prev,
          status: 'success',
          systemPrompt: result.systemPrompt,
          userPrompt: result.userPrompt,
          analysisResults: result.analysisResults,
          reasoning: '', // We're not currently returning reasoning from the server action
        }));
        
        // Update the success status
        setProcessStatus({
          status: 'success',
          message: 'Video analyzed successfully with Claude!',
          step: 'analyzing-pattern',
          progress: 100,
          isOpen: false
        });
        
        toast({
          title: "Analysis Complete",
          description: "Claude has analyzed the video content successfully.",
        });
        
        // Refresh the video list
        fetchVideos();
      } catch (error) {
        console.error("Error in Server Action:", error);
        throw error;
      } finally {
        clearInterval(progressInterval);
      }
      
    } catch (error) {
      console.error("Error analyzing video:", error);
      
      // Update modal with error
      setProcessStatus({
        status: 'error',
        message: error instanceof Error ? error.message : "Failed to analyze video",
        progress: 0,
        isOpen: false
      });
      
      // Update debug data with error
      setDebugData(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : "Failed to analyze video"
      }));
      
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Failed to analyze the video with Claude.",
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
  
  // Helper function to validate analysis results structure
  const validateAnalysisResults = (data: any) => {
    // Check if the data has at least one of the expected top-level keys
    const requiredKeys = ['content_analysis', 'audience_analysis', 'framework_elements', 
      'content_gaps', 'engagement_techniques', 'value_delivery', 'implementation_blueprint'];
    
    if (!data) {
      console.error('Analysis results is null or undefined');
      return false;
    }
    
    if (typeof data !== 'object') {
      console.error('Analysis results is not an object:', typeof data);
      return false;
    }
    
    // If we got a string (perhaps markdown or raw text), try to extract JSON
    if (typeof data === 'string') {
      console.log('Received string data, attempting to parse as JSON');
      try {
        // Check for markdown
        const markdownMatch = data.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (markdownMatch && markdownMatch[1]) {
          console.log('Found markdown code block in validation');
          data = JSON.parse(markdownMatch[1].trim());
        } else {
          // Try direct parsing
          data = JSON.parse(data);
        }
        console.log('Successfully parsed string into JSON object');
      } catch (e) {
        console.error('Failed to parse string as JSON:', e);
        return false;
      }
    }
    
    // Check if there are any keys at all
    const keys = Object.keys(data);
    if (keys.length === 0) {
      console.error('Analysis results is an empty object');
      return false;
    }
    
    // Double check the data structure of content_analysis if present
    if (data.content_analysis) {
      console.log('Found content_analysis key, checking structure');
      const contentKeys = Object.keys(data.content_analysis);
      console.log('Content analysis keys:', contentKeys.join(', '));
    }
    
    // Check if at least one of the required keys exists
    const hasRequiredKey = requiredKeys.some(key => key in data);
    if (!hasRequiredKey) {
      console.error('Analysis results missing required keys. Found:', keys.join(', '));
    } else {
      console.log('Validation passed: found required keys in analysis results');
    }
    
    return hasRequiredKey;
  };

  // Enhanced JSON extraction for streamed responses
  const extractJsonFromStream = (text: string) => {
    if (!text || typeof text !== 'string') {
      console.error('Invalid text provided to extractJsonFromStream:', text);
      return null;
    }
    
    console.log('Attempting to extract JSON from text length:', text.length);
    
    // First check if we have a markdown code block and strip it
    let processedText = text;
    const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (markdownMatch && markdownMatch[1]) {
      console.log('Found markdown code block, extracting content');
      processedText = markdownMatch[1].trim();
    }
    
    // First try direct parsing
    try {
      const parsed = JSON.parse(processedText);
      console.log('Successfully parsed complete JSON directly');
      return parsed;
    } catch (e) {
      // Direct parsing failed, try extraction methods
    }
    
    // Look for complete JSON objects with a robust pattern
    try {
      // Try to find all JSON-like patterns
      const jsonPattern = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g;
      const matches = [...processedText.matchAll(jsonPattern)];
      
      if (matches.length > 0) {
        // Get the largest match, which is likely the most complete
        let largestMatch = matches[0][0];
        let largestLength = largestMatch.length;
        
        for (const match of matches) {
          if (match[0].length > largestLength) {
            largestMatch = match[0];
            largestLength = match[0].length;
          }
        }
        
        console.log('Found JSON object in stream with length:', largestLength);
        const parsed = JSON.parse(largestMatch);
        return parsed;
      }
    } catch (e) {
      console.error('Failed to extract with robust pattern:', e);
    }
    
    // Try a simpler approach with regex for JSON-like structure
    try {
      const simpleMatch = processedText.match(/\{[\s\S]*\}/);
      if (simpleMatch) {
        console.log('Found JSON with simple pattern, length:', simpleMatch[0].length);
        const parsed = JSON.parse(simpleMatch[0]);
        return parsed;
      }
    } catch (e) {
      console.error('Failed to extract with simple pattern:', e);
    }
    
    // Last resort: try to find the largest balanced braces block
    try {
      let maxStart = -1;
      let maxEnd = -1;
      let maxLength = 0;
      
      for (let i = 0; i < processedText.length; i++) {
        if (processedText[i] === '{') {
          // Found an opening brace, try to find the matching closing brace
          let depth = 1;
          for (let j = i + 1; j < processedText.length; j++) {
            if (processedText[j] === '{') depth++;
            else if (processedText[j] === '}') depth--;
            
            if (depth === 0) {
              // Found a balanced block
              const length = j - i + 1;
              if (length > maxLength) {
                maxStart = i;
                maxEnd = j;
                maxLength = length;
              }
              break;
            }
          }
        }
      }
      
      if (maxStart >= 0 && maxLength > 10) { // Minimum size to consider valid
        const jsonCandidate = processedText.substring(maxStart, maxEnd + 1);
        console.log('Found balanced JSON with manual parsing, length:', jsonCandidate.length);
        const parsed = JSON.parse(jsonCandidate);
        return parsed;
      }
    } catch (e) {
      console.error('Failed with manual balanced brace extraction:', e);
    }
    
    console.error('Could not extract valid JSON after trying all methods');
    return null;
  };

  // Function to handle saving analysis results to database
  const handleSaveAnalysis = async () => {
    try {
      // Get the selected model from debugData
      const selectedModel = debugData.modelId || 'claude-3-7-sonnet-20240620'; // Default model

      // Determine which analysis results to use
      let analysisResults = null;
      
      // Try multiple sources for analysis results in order of preference
      if (parsedStreamData && Object.keys(parsedStreamData).length > 0) {
        console.log('Using parsedStreamData:', Object.keys(parsedStreamData).join(', '));
        analysisResults = parsedStreamData;
      } else if (debugData.analysisResults && Object.keys(debugData.analysisResults).length > 0) {
        console.log('Using debugData.analysisResults:', Object.keys(debugData.analysisResults).join(', '));
        analysisResults = debugData.analysisResults;
      } else if (debugModalRef.current?.streamedText) {
        const streamedText = debugModalRef.current.streamedText;
        console.log('Attempting extraction from streamedText length:', streamedText.length);
        
        // Check for markdown code block markers
        if (streamedText.includes('```json') || (streamedText.includes('```') && streamedText.includes('{'))) {
          console.log('Detected markdown code block in streamedText');
          
          // Extract the JSON from the markdown code block
          const markdownMatch = streamedText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (markdownMatch && markdownMatch[1]) {
            const jsonContent = markdownMatch[1].trim();
            console.log('Extracted content from markdown block, attempting to parse');
            
            try {
              analysisResults = JSON.parse(jsonContent);
              console.log('Successfully parsed markdown code block:', 
                Object.keys(analysisResults).join(', '));
            } catch (e) {
              console.log('Failed to parse extracted markdown content:', e);
            }
          }
        }
        
        // If markdown extraction failed, try the full extraction method
        if (!analysisResults) {
          analysisResults = extractJsonFromStream(streamedText);
        }
        
        if (analysisResults) {
          console.log('Successfully extracted JSON from streamedText:', Object.keys(analysisResults).join(', '));
          
          // If we successfully parse, update the parsedStreamData state as well
          setParsedStreamData(analysisResults);
        }
      }
      
      // Complete debug logging to help diagnose issues
      console.log('Analysis sources status:', {
        hasParsedStreamData: !!parsedStreamData,
        parsedStreamDataKeys: parsedStreamData ? Object.keys(parsedStreamData) : 'none',
        hasDebugDataResults: !!debugData.analysisResults,
        debugDataResultsKeys: debugData.analysisResults ? Object.keys(debugData.analysisResults) : 'none',
        hasStreamedText: !!debugModalRef.current?.streamedText,
        streamedTextLength: debugModalRef.current?.streamedText?.length || 0,
        extractedResults: !!analysisResults,
        extractedResultsKeys: analysisResults ? Object.keys(analysisResults) : 'none'
      });
      
      if (!analysisResults) {
        console.error('No analysis results available from any source');
        throw new Error('No analysis results available to save');
      }
      
      // Validate that analysis results have the expected structure
      if (!validateAnalysisResults(analysisResults)) {
        console.error('Invalid analysis results structure:', analysisResults);
        
        // Create a more specific error message
        let errorMessage = 'Analysis results are not in the expected format';
        
        if (typeof analysisResults !== 'object') {
          errorMessage = `Invalid type: expected object but got ${typeof analysisResults}`;
        } else if (Object.keys(analysisResults).length === 0) {
          errorMessage = 'Empty object: analysis results contains no data';
        } else {
          const requiredKeys = ['content_analysis', 'audience_analysis', 'framework_elements', 
            'content_gaps', 'engagement_techniques', 'value_delivery', 'implementation_blueprint'];
          const foundKeys = Object.keys(analysisResults);
          errorMessage = `Missing required keys. Found: ${foundKeys.join(', ')}. Need at least one of: ${requiredKeys.join(', ')}`;
        }
        
        throw new Error(`Invalid analysis results structure: ${errorMessage}`);
      }

      console.log('Saving analysis results:', {
        videoId: debugData.videoId,
        modelId: selectedModel,
        hasData: !!analysisResults,
        dataKeys: Object.keys(analysisResults)
      });

      const response = await fetch('/api/skyscraper/analyze-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: debugData.videoId,
          userId: '00000000-0000-0000-0000-000000000000', // Default user ID
          modelId: selectedModel,
          analysisResults: analysisResults,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Failed to save analysis results: ${response.status}`);
      }

      const result = await response.json();
      console.log('Save response:', result);
      
      toast({
        title: 'Save Successful',
        description: 'Analysis results saved to the database.',
      });
    } catch (error) {
      console.error('Error saving analysis:', error);
      toast({
        title: 'Save Failed',
        description: error instanceof Error ? error.message : 'Failed to save analysis results',
        variant: 'destructive',
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
  
  // Add this function after the startAnalysis function
  const startStreamAnalysis = async (modelId?: string) => {
    try {
      const videoId = debugData.videoId;
      
      // Update UI to show processing
      setProcessStatus({ 
        status: 'processing', 
        message: 'Starting streaming analysis...',
        step: 1,
        progress: 5,
        isOpen: false
      });

      // Update debug data to show loading state and save the modelId
      setDebugData(prev => ({
        ...prev,
        status: 'loading',
        modelId: modelId || 'claude-3-7-sonnet-20240620' // Save the selected model ID
      }));

      toast({
        title: "Streaming Started",
        description: "Claude is analyzing the video content in streaming mode.",
      });
      
      // Note: The actual streaming happens in the SkyscraperDebugModal component using the useChat hook
      
    } catch (error) {
      console.error("Error starting streaming analysis:", error);
      
      // Update debug data with error
      setDebugData(prev => ({
        ...prev,
        status: 'error',
        error: error instanceof Error ? error.message : "Failed to start streaming analysis"
      }));
      
      toast({
        title: "Streaming Failed",
        description: error instanceof Error ? error.message : "Failed to start streaming analysis with Claude.",
        variant: "destructive",
      });
    }
  };
  
  // First add the import for the formatAnalysisMarkdown utility
  const downloadAnalysis = async (videoId: string, title: string) => {
    try {
      // Fetch the analysis data
      const response = await fetch(`/api/skyscraper/get-analysis?videoId=${videoId}`);
      
      if (!response.ok) {
        throw new Error("Failed to fetch analysis data");
      }
      
      const data = await response.json();
      
      // Format the analysis as markdown
      const markdown = formatAnalysisMarkdown(
        { 
          title: data.video.title, 
          channelTitle: data.video.channelTitle // This is actually channel_id in the database
        }, 
        data.analysis
      );
      
      // Create a blob from the markdown content
      const blob = new Blob([markdown], { type: 'text/markdown' });
      
      // Create a download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_analysis.md`;
      document.body.appendChild(a);
      a.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
      
      toast({
        title: "Analysis Downloaded",
        description: "The analysis has been downloaded as a markdown file.",
      });
    } catch (error) {
      console.error("Error downloading analysis:", error);
      toast({
        title: "Download Failed",
        description: "Failed to download the analysis. Please try again.",
        variant: "destructive",
      });
    }
  };
  
  // Add batch download functions
  const batchDownloadScripts = async () => {
    if (selectedVideos.size === 0) return;
    
    try {
      toast({
        title: "Preparing Downloads",
        description: `Retrieving transcripts and comments for ${selectedVideos.size} videos...`,
      });
      
      setIsLoading(true);
      
      // Get video details for selected videos
      const selectedVideoDetails = videos.filter(v => selectedVideos.has(v.id));
      
      // Build a request that includes all selected video IDs
      const response = await fetch(`/api/vector/comments/batch-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: Array.from(selectedVideos),
          includeTranscript: true,
          includeComments: true
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch batch transcripts");
      }
      
      const data = await response.json();
      
      if (!data.content) {
        throw new Error("No content available for the selected videos");
      }
      
      // Create and trigger download
      const blob = new Blob([data.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `batch-transcripts-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Download Complete",
        description: `Downloaded content for ${selectedVideos.size} videos`,
      });
      
    } catch (error) {
      console.error("Error downloading batch transcripts:", error);
      toast({
        title: "Batch Download Failed",
        description: error instanceof Error ? error.message : "Failed to download batch transcripts",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const batchDownloadAnalyses = async () => {
    if (selectedVideos.size === 0) return;
    
    try {
      toast({
        title: "Preparing Downloads",
        description: `Retrieving analyses for ${selectedVideos.size} videos...`,
      });
      
      setIsLoading(true);
      
      // Get video details for selected videos
      const selectedVideoDetails = videos.filter(v => selectedVideos.has(v.id));
      
      // Verify all selected videos have analyses
      const videosWithoutAnalysis = selectedVideoDetails.filter(v => !v.hasSkyscraperAnalysis);
      if (videosWithoutAnalysis.length > 0) {
        throw new Error(`${videosWithoutAnalysis.length} of the selected videos do not have analyses`);
      }
      
      // Build a request that includes all selected video IDs
      const response = await fetch(`/api/skyscraper/batch-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: Array.from(selectedVideos)
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch batch analyses");
      }
      
      const data = await response.json();
      
      if (!data.content) {
        throw new Error("No analysis content available for the selected videos");
      }
      
      // Create and trigger download
      const blob = new Blob([data.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `batch-analyses-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Download Complete",
        description: `Downloaded analyses for ${selectedVideos.size} videos`,
      });
      
    } catch (error) {
      console.error("Error downloading batch analyses:", error);
      toast({
        title: "Batch Download Failed",
        description: error instanceof Error ? error.message : "Failed to download batch analyses",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
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
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={batchDownloadScripts}
                        disabled={selectedVideos.size === 0 || isLoading}
                        className="flex items-center bg-gray-700 border-gray-600 text-gray-200 hover:bg-gray-600"
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        Download Scripts
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={batchDownloadAnalyses}
                        disabled={selectedVideos.size === 0 || isLoading || videos.filter(v => selectedVideos.has(v.id) && v.hasSkyscraperAnalysis).length === 0}
                        className="flex items-center bg-green-900 border-green-800 text-green-200 hover:bg-green-800"
                      >
                        <FileDown className="h-4 w-4 mr-2" />
                        Download Analyses
                      </Button>
                      
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
                          {video.hasSkyscraperAnalysis && (
                            <>
                              <span className="mx-2">•</span>
                              <span className="text-green-500 flex items-center">
                                <Check className="h-3.5 w-3.5 mr-1" />
                                Analyzed
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {/* Main action buttons */}
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => window.open(`/analysis/${video.id}`, '_blank')}
                          className="bg-blue-900 border-blue-800 text-blue-200 hover:bg-blue-800 hover:text-white"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View Details
                        </Button>
                        
                        {/* Dropdown menu for more actions */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-white">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 bg-gray-900 border-gray-800 text-gray-200">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator className="bg-gray-800" />
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                className="focus:bg-gray-800 focus:text-gray-200 cursor-pointer"
                                onClick={() => downloadTranscript(video.id, video.title)}
                              >
                                <FileText className="h-4 w-4 mr-2 text-blue-500" />
                                <span>Download Script</span>
                              </DropdownMenuItem>
                              {video.hasSkyscraperAnalysis && (
                                <DropdownMenuItem
                                  className="focus:bg-gray-800 focus:text-gray-200 cursor-pointer"
                                  onClick={() => downloadAnalysis(video.id, video.title)}
                                >
                                  <FileDown className="h-4 w-4 mr-2 text-green-500" />
                                  <span>Download Analysis</span>
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="bg-gray-800" />
                              <DropdownMenuItem
                                className="focus:bg-gray-800 focus:text-gray-200 cursor-pointer"
                                onClick={() => reprocessVideo(video.id)}
                              >
                                <RefreshCw className="h-4 w-4 mr-2 text-yellow-500" />
                                <span>Redownload Script</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="focus:bg-gray-800 focus:text-gray-200 cursor-pointer"
                                onClick={() => analyzeVideo(video.id)}
                              >
                                <RefreshCcw className="h-4 w-4 mr-2 text-purple-500" />
                                <span>Reanalyze</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-gray-800" />
                              <DropdownMenuItem
                                className="focus:bg-red-900 focus:text-red-200 cursor-pointer text-red-400"
                                onClick={() => handleDeleteClick(video.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                <span>Delete Video</span>
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
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
        ref={debugModalRef}
        isOpen={debugModalOpen}
        onClose={() => setDebugModalOpen(false)}
        debugData={debugData}
        onSaveAnalysis={handleSaveAnalysis}
        onStartAnalysis={startAnalysis}
        onStartStreamAnalysis={startStreamAnalysis}
        parsedStreamData={parsedStreamData}
        setParsedStreamData={setParsedStreamData}
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