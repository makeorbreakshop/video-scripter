"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlignJustify, FileText, Loader2, Trash2, Youtube, FileDown, Clipboard, Database, Bot } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { DocumentType } from "@/types/workflow"
import { getYoutubeTranscript } from "@/lib/youtube-transcript"
import { supabase } from "@/lib/supabase"
import { getYoutubeVideoMetadata } from "@/lib/youtube-utils"
import { fetchYoutubeComments } from "@/lib/youtube-api"
import Image from "next/image"
import { analyzeVideoContent, AIAnalysisResult } from "@/lib/openai-api"
import { VideoAnalysisResult } from "@/components/video-analysis-result"

function extractYouTubeId(url: string): string | null {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

interface VideoResearchToolProps {
  data?: any
  updateData?: (data: any) => void
  createDocument?: (type: DocumentType | any, title?: string, initialContent?: string) => any
  projectId?: string
  userId?: string
  isInsideScriptEditor?: boolean
  hideHeader?: boolean
}

export function VideoResearchTool(props: VideoResearchToolProps) {
  return <VideoResearchToolImpl {...props} />;
}

export default function VideoResearchToolImpl({
  data = { videoUrls: [], videoMetadata: {} },
  updateData = () => {},
  createDocument = () => {},
  projectId = "",
  userId = "",
  isInsideScriptEditor = false,
  hideHeader = false,
}: VideoResearchToolProps) {
  // DEVELOPMENT ONLY: Default user ID for testing without authentication
  // TODO: Remove this in production - all users should be properly authenticated
  const DEVELOPMENT_USER_ID = "00000000-0000-0000-0000-000000000000"; // Fixed UUID for testing
  const DEVELOPMENT_PROJECT_ID = "00000000-0000-0000-0000-000000000001"; // Fixed UUID for testing
  
  // Log data structure and validate it on mount
  useEffect(() => {
    console.log('📊 VideoResearchTool mounted with data:', data);
    
    // Check data structure integrity
    if (!data) {
      console.error('❌ Data object is missing entirely');
      updateData({ videoUrls: [], videoMetadata: {} });
      return;
    }
    
    // Validate and fix videoUrls if needed
    if (!data.videoUrls) {
      console.warn('⚠️ videoUrls property is missing, initializing empty array');
      const updatedData = { ...data, videoUrls: [] };
      updateData(updatedData);
    } else if (!Array.isArray(data.videoUrls)) {
      console.error('❌ videoUrls is not an array, fixing data structure');
      const updatedData = { ...data, videoUrls: [] };
      updateData(updatedData);
    } else {
      console.log('✅ videoUrls exists and is valid:', data.videoUrls);
    }
    
    // Validate videoMetadata
    if (!data.videoMetadata) {
      console.warn('⚠️ videoMetadata property is missing, initializing empty object');
      const updatedData = { ...data, videoMetadata: {} };
      updateData(updatedData);
    }
  }, []);
  
  // Ensure data structure is valid whenever data changes
  useEffect(() => {
    // Initialize videoUrls array if it doesn't exist
    if (!data?.videoUrls) {
      console.log('⚠️ videoUrls array missing or invalid, initializing empty array');
      updateData({ ...data, videoUrls: [] });
    }
  }, [data, updateData]);
  
  const effectiveUserId = userId || DEVELOPMENT_USER_ID;
  const effectiveProjectId = projectId || DEVELOPMENT_PROJECT_ID;
  
  // State for video URLs
  const [videoUrl, setVideoUrl] = useState("")
  const [localVideoUrls, setLocalVideoUrls] = useState<string[]>([])
  
  // State for video transcripts and processing
  const [transcriptContent, setTranscriptContent] = useState("")
  const [isProcessingTranscripts, setIsProcessingTranscripts] = useState(false)
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [videoMetadata, setVideoMetadata] = useState<{ [key: string]: any }>({})
  const [showExtraButtons, setShowExtraButtons] = useState(false)
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 })
  
  // State for AI analysis
  const [analysisResult, setAnalysisResult] = useState<AIAnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  
  // State for mobile view
  const [showSidebar, setShowSidebar] = useState(false)
  
  // Track the last created document for analysis
  const [lastCreatedDocId, setLastCreatedDocId] = useState<string | null>(null);
  const [lastCreatedDocContent, setLastCreatedDocContent] = useState<string | null>(null);
  
  // Add these debugging variables near the other state variables
  const [aiDebugInfo, setAiDebugInfo] = useState<{
    buttonClicked: boolean;
    apiKeyStatus: string;
    contentAnalyzed: boolean;
    error: string | null;
    timestamp: string | null;
  }>({
    buttonClicked: false,
    apiKeyStatus: 'Not checked',
    contentAnalyzed: false,
    error: null,
    timestamp: null
  });
  
  // Synchronize local state with parent state and prevent data loss
  useEffect(() => {
    console.log('Synchronizing states: data.videoUrls:', data?.videoUrls, 'localVideoUrls:', localVideoUrls);
    
    const dataUrls = data?.videoUrls && Array.isArray(data.videoUrls) ? data.videoUrls : [];
    
    // Case 1: Both data and local state have videos - we need to merge them
    if (dataUrls.length > 0 && localVideoUrls.length > 0) {
      // Check if they are different
      if (JSON.stringify(dataUrls.sort()) !== JSON.stringify(localVideoUrls.sort())) {
        console.log('⚙️ Detected different URLs in data and local state - merging');
        
        // Merge the arrays removing duplicates
        const mergedUrls = [...new Set([...dataUrls, ...localVideoUrls])];
        
        // If the merged list is different from both
        if (mergedUrls.length !== dataUrls.length || mergedUrls.length !== localVideoUrls.length) {
          console.log('🔄 Updating both states with merged list:', mergedUrls);
          
          // Update local state
          setLocalVideoUrls(mergedUrls);
          
          // Update parent data
          const updatedData = JSON.parse(JSON.stringify(data || {}));
          updatedData.videoUrls = mergedUrls;
          
          // Make sure to preserve videoMetadata if it exists
          if (!updatedData.videoMetadata) {
            updatedData.videoMetadata = {};
          }
          
          console.log('📤 Sending merged update to parent with all videos');
          updateData(updatedData);
        }
      }
    }
    // Case 2: Data has videos but local state doesn't
    else if (dataUrls.length > 0 && localVideoUrls.length === 0) {
      console.log('📥 Updating local videoUrls from data:', dataUrls);
      setLocalVideoUrls([...dataUrls]);
    }
    // Case 3: Local state has videos but data doesn't
    else if (dataUrls.length === 0 && localVideoUrls.length > 0) {
      console.log('⚠️ Data reset detected! Restoring from local state:', localVideoUrls);
      
      // Create a proper data structure with our local URLs
      const updatedData = JSON.parse(JSON.stringify(data || {})); 
      updatedData.videoUrls = [...localVideoUrls];
      
      // Make sure to preserve videoMetadata if it exists
      if (!updatedData.videoMetadata) {
        updatedData.videoMetadata = {};
      }
      
      // Update the parent component with our preserved data
      console.log('📤 Sending update to parent with restored data:', updatedData);
      updateData(updatedData);
    }
  }, [data, localVideoUrls, updateData]);

  // Additional synchronization check that runs when component renders or when videos change
  useEffect(() => {
    // This is a redundant check that runs on a timer to ensure state consistency
    const intervalId = setInterval(() => {
      const dataUrls = data?.videoUrls && Array.isArray(data.videoUrls) ? data.videoUrls : [];
      
      // If local state has videos but parent data doesn't, restore from local state
      if (localVideoUrls.length > 0 && dataUrls.length === 0) {
        console.log('🚨 Periodic check detected missing videos in parent data! Restoring...');
        
        const updatedData = JSON.parse(JSON.stringify(data || {}));
        updatedData.videoUrls = [...localVideoUrls];
        
        if (!updatedData.videoMetadata) {
          updatedData.videoMetadata = {};
        }
        
        updateData(updatedData);
      }
      // If parent data has videos but local state doesn't, update local state
      else if (dataUrls.length > 0 && localVideoUrls.length === 0) {
        console.log('🚨 Periodic check detected missing videos in local state! Updating...');
        setLocalVideoUrls([...dataUrls]);
      }
      // If both have different video counts, merge them
      else if (dataUrls.length !== localVideoUrls.length) {
        console.log('🚨 Periodic check detected video count mismatch! Merging...');
        
        const mergedUrls = [...new Set([...dataUrls, ...localVideoUrls])];
        setLocalVideoUrls(mergedUrls);
        
        const updatedData = JSON.parse(JSON.stringify(data || {}));
        updatedData.videoUrls = mergedUrls;
        
        if (!updatedData.videoMetadata) {
          updatedData.videoMetadata = {};
        }
        
        updateData(updatedData);
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(intervalId);
  }, [data, localVideoUrls, updateData]);

  // Check if we have valid URLs available for processing
  useEffect(() => {
    const hasCurrentUrl = videoUrl && videoUrl.trim() !== '' && extractYouTubeId(videoUrl) !== null;
    const hasUrlsInList = data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0;
    
    if (hasCurrentUrl) {
      console.log(`🔍 Current URL is valid: ${videoUrl}`);
    }
    
    if (hasUrlsInList) {
      console.log(`🔍 URLs in list: ${data.videoUrls.length}`, data.videoUrls);
    } else {
      console.warn('⚠️ No URLs in list or invalid data structure:', data?.videoUrls);
    }
    
    setShowExtraButtons(hasCurrentUrl || hasUrlsInList);
    console.log(`🔍 URL state check: Current URL valid: ${hasCurrentUrl}, URLs in list: ${hasUrlsInList}, Button should be: ${!(isProcessingTranscripts || !hasUrlsInList) ? 'ENABLED' : 'DISABLED'}`);
  }, [videoUrl, data?.videoUrls, isProcessingTranscripts]);

  // Load metadata for existing videos when component mounts
  useEffect(() => {
    const loadMetadataForExistingVideos = async () => {
      // Process each video URL in the list
      for (const url of data.videoUrls) {
        const videoId = extractYouTubeId(url);
        
        // Skip if we already have metadata for this video
        if (videoId && 
            (!videoMetadata[videoId] && 
             (!data.videoMetadata || !data.videoMetadata[videoId]))) {
          await fetchVideoMetadata(url);
        }
      }
      
      // If we have a videoUrl in the input field, fetch its metadata too
      if (videoUrl) {
        const videoId = extractYouTubeId(videoUrl);
        if (videoId && !videoMetadata[videoId]) {
          await fetchVideoMetadata(videoUrl);
        }
      }
    };
    
    loadMetadataForExistingVideos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Direct, no-frills test document creation 
  const createTestDocument = async () => {
    try {
      // Super simple content
      const simpleContent = `<h1>Test Document ${Date.now()}</h1><p>This is a test paragraph.</p>`;
      
      // Log content details
      console.log(`Creating test document with content (${simpleContent.length} chars)`);
      
      // Create the document directly with the content
      const newDoc = await createDocument("research", "Test Document", simpleContent);
      
      if (!newDoc) {
        throw new Error("Document creation returned null");
      }
      
      toast({
        title: "Test Document Created",
        description: "Document was created. Check if content appears.",
      });
    } catch (error) {
      console.error('Error creating test document:', error);
      toast({
        title: "Error",
        description: `Failed to create test document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };

  // Add function to fetch and store metadata when a video is added
  const fetchVideoMetadata = async (url: string) => {
    try {
      const metadata = await getYoutubeVideoMetadata(url);
      const videoId = extractYouTubeId(url);
      
      if (videoId) {
        // Update the metadata state
        setVideoMetadata(prev => ({
          ...prev,
          [videoId]: metadata
        }));
        
        // Update data with the metadata but preserve videoUrls by using deep copy
        const updatedData = JSON.parse(JSON.stringify(data || {}));
        
        // Ensure we have videoMetadata
        if (!updatedData.videoMetadata) {
          updatedData.videoMetadata = {};
        }
        
        // Ensure videoUrls is preserved
        if (!updatedData.videoUrls) {
          // Use our local state if available
          updatedData.videoUrls = [...localVideoUrls];
        }
        
        // Add the new metadata
        updatedData.videoMetadata[videoId] = metadata;
        
        console.log('📋 Updating metadata while preserving videoUrls:', updatedData.videoUrls);
        
        // Update the parent with complete data
        updateData(updatedData);
        
        // If this is the URL in the input field, update current thumbnail/title
        if (url === videoUrl) {
          setCurrentVideoThumbnail(metadata.thumbnailUrl);
          setCurrentVideoTitle(metadata.title);
        }
      }
      
      return metadata;
    } catch (error) {
      console.error('Failed to fetch video metadata:', error);
      return null;
    }
  };

  // Update addVideo to fetch metadata and update state in a single operation
  const addVideo = async () => {
    if (!videoUrl) {
      toast({
        title: "No URL",
        description: "Please enter a YouTube URL",
        variant: "destructive",
      });
      return;
    }

    // Check if it's a valid YouTube URL
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid YouTube URL",
        variant: "destructive",
      });
      return;
    }

    console.log(`➕ Beginning add process for URL: ${videoUrl} (ID: ${videoId})`);
    
    try {
      // First, create a deep copy of current data
      const updatedData = JSON.parse(JSON.stringify(data || {}));
      
      // Ensure videoUrls exists and is an array
      if (!updatedData.videoUrls) {
        updatedData.videoUrls = [];
      }
      
      // Check if URL is already in the list
      if (updatedData.videoUrls.includes(videoUrl)) {
        toast({
          title: "URL Already Added",
          description: "This YouTube video is already in your list",
          variant: "destructive",
        });
        setVideoUrl("");
        return;
      }
      
      // Add the URL to the list
      updatedData.videoUrls.push(videoUrl);
      console.log('📋 Added URL to list:', updatedData.videoUrls);
      
      // Update local state immediately to prevent loss
      setLocalVideoUrls([...updatedData.videoUrls]);
      
      // NOW FETCH METADATA IN THE SAME FUNCTION
      console.log('🔄 Fetching metadata for video:', videoId);
      
      // Show "loading" toast
      toast({
        title: "Adding Video",
        description: "Fetching video information...",
      });
      
      // Fetch metadata
      const metadata = await getYoutubeVideoMetadata(videoUrl);
      
      // Ensure we have videoMetadata structure
      if (!updatedData.videoMetadata) {
        updatedData.videoMetadata = {};
      }
      
      // Add the metadata to our updated data
      updatedData.videoMetadata[videoId] = metadata;
      
      console.log('✅ Complete data update ready:', {
        urls: updatedData.videoUrls,
        metadata: Object.keys(updatedData.videoMetadata)
      });
      
      // Update the parent with the COMPLETE data including both URL and metadata
      updateData(updatedData);
      
      // If this is the URL in the input field, update current thumbnail/title
      setCurrentVideoThumbnail(metadata.thumbnailUrl);
      setCurrentVideoTitle(metadata.title);
      
      toast({
        title: "Video Added",
        description: "YouTube video added to the list with metadata",
      });
      
      // Clear the input field
      setVideoUrl("");
    } catch (error) {
      console.error('Failed to add video or fetch metadata:', error);
      
      // Even if metadata fails, still add the URL
      const fallbackData = JSON.parse(JSON.stringify(data || {}));
      if (!fallbackData.videoUrls) {
        fallbackData.videoUrls = [];
      }
      
      // Only add if not already present
      if (!fallbackData.videoUrls.includes(videoUrl)) {
        fallbackData.videoUrls.push(videoUrl);
        setLocalVideoUrls([...fallbackData.videoUrls]);
        updateData(fallbackData);
      }
      
      toast({
        title: "Video Added (Partial)",
        description: "Added URL but couldn't fetch video details",
        variant: "destructive",
      });
      
      // Clear the input field
      setVideoUrl("");
    }
  };

  const removeVideo = (url: string) => {
    console.log(`➖ Beginning removal process for URL: ${url}`);
    
    // Create a deep copy of the current data to avoid reference issues
    const updatedData = JSON.parse(JSON.stringify(data || {}));
    
    // Ensure videoUrls exists and is an array
    if (!Array.isArray(updatedData.videoUrls)) {
      console.log('⚠️ videoUrls was not an array during removal attempt, cannot remove');
      toast({
        title: "Error",
        description: "Cannot remove video - invalid data structure",
        variant: "destructive",
      });
      return;
    }
    
    // Filter out the specified URL
    updatedData.videoUrls = updatedData.videoUrls.filter((u: string) => u !== url);
    console.log('📋 Updated video URLs list after removal:', updatedData.videoUrls);
    
    // Update local state to maintain consistency
    setLocalVideoUrls([...updatedData.videoUrls]);
    
    // Ensure videoMetadata is preserved
    if (!updatedData.videoMetadata) {
      updatedData.videoMetadata = {};
    }
    
    // Update the parent state with the complete data
    console.log('📤 Sending complete state update after removal');
    updateData(updatedData);
    
    toast({
      title: "Video Removed",
      description: "YouTube video removed from the list",
    });
  };

  // Function to get metadata for a video URL
  const getMetadataForUrl = (url: string) => {
    const videoId = extractYouTubeId(url);
    if (!videoId) return null;
    
    // Try to get from videoMetadata state
    const metadata = videoMetadata[videoId] || 
                     (data.videoMetadata && data.videoMetadata[videoId]);
    
    return metadata;
  };

  const createTranscriptDocument = async () => {
    if (data.videoUrls.length === 0) {
      toast({
        title: "No videos",
        description: "Please add at least one YouTube video URL",
        variant: "destructive",
      });
      return;
    }

    setIsProcessingTranscripts(true);
    setShowExtraButtons(false);
    console.log('🚀 Starting transcript extraction - DOWNLOAD FOCUSED APPROACH');

    try {
      // Get the first video URL
      const url = data.videoUrls[0];
      const videoId = extractYouTubeId(url) || 'unknown';
      
      // Fetch transcript
      console.log(`🎬 Fetching transcript for video: ${videoId} from URL: ${url}`);
      
      let transcript;
      try {
        transcript = await getYoutubeTranscript(url);
        console.log(`✅ Transcript received: ${transcript?.length || 0} characters`);
      } catch (error) {
        const transcriptError = error as Error;
        console.error('❌ Failed to fetch transcript:', transcriptError);
        setIsProcessingTranscripts(false);
        toast({
          title: "Transcript Error",
          description: `Could not fetch transcript: ${transcriptError.message || 'Unknown error'}`,
          variant: "destructive",
        });
        return;
      }
      
      if (!transcript || transcript.length < 10) {
        console.error('❌ Transcript is too short or empty:', transcript);
        setIsProcessingTranscripts(false);
        throw new Error("Transcript is too short or empty");
      }
      
      // Create simple HTML content
      const docTitle = `Transcript: YouTube ${videoId}`;
      
      // Simple HTML formatting - don't use complicated structure
      let htmlContent = `<h1>${docTitle}</h1>`;
      htmlContent += `<p><strong>Video ID:</strong> ${videoId}</p>`;
      htmlContent += `<p><strong>Extracted:</strong> ${new Date().toLocaleString()}</p>`;
      htmlContent += `<h2>Video Transcript</h2>`;
      
      // Use simple text content for the transcript
      htmlContent += `<p>${transcript.replace(/\n\s*\n/g, "<br/><br/>")}</p>`;
      
      console.log(`📝 Formatted content: ${htmlContent.length} characters`);
      
      // Save transcript content for clipboard/download
      setTranscriptContent(htmlContent);
      setShowExtraButtons(true);
      
      // Show toast about clipboard and download options
      toast({
        title: "Transcript Available",
        description: "Use the buttons below to copy or download the transcript",
      });
      
      // Try to create a document in the background
      try {
        console.log('📄 Attempting to create document as backup...');
        
        // Create a new document each time, but don't rely on its content
        const doc = await createDocument("research", docTitle, htmlContent);
        
        if (doc && Array.isArray(doc)) {
          // If it's an array, use the first element
          setLastCreatedDocId(doc[0]?.id || null);
          setLastCreatedDocContent(htmlContent);
          
          // Show a toast that analysis is now available
          toast({
            title: "Document Created",
            description: "Document created successfully. You can now analyze it with AI.",
          });
        } else if (doc) {
          // If it's a single object
          setLastCreatedDocId(doc.id || null);
          setLastCreatedDocContent(htmlContent);
          
          // Show a toast that analysis is now available
          toast({
            title: "Document Created",
            description: "Document created successfully. You can now analyze it with AI.",
          });
        }
      } catch (docError) {
        console.error("⚠️ Document creation failed, but transcript is available:", docError);
        // Don't show toast for this - we already have the content available via buttons
      }
    } catch (error) {
      console.error("🚨 Error extracting transcript:", error);
      toast({
        title: "Error",
        description: `Failed to extract transcript: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setIsProcessingTranscripts(false);
    }
  };

  // Function to copy transcript to clipboard
  const copyToClipboard = () => {
    try {
      // Convert HTML to plain text for clipboard
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = transcriptContent;
      const plainText = tempDiv.textContent || tempDiv.innerText || "";
      
      navigator.clipboard.writeText(plainText);
      
      toast({
        title: "Copied",
        description: "Transcript copied to clipboard",
      });
    } catch (error) {
      console.error("Clipboard error:", error);
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  // Function to download transcript as markdown
  const downloadAsMarkdown = () => {
    try {
      // Convert HTML to markdown-like format
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = transcriptContent;
      
      let markdown = "";
      const h1Elements = tempDiv.querySelectorAll('h1');
      const h2Elements = tempDiv.querySelectorAll('h2');
      const h3Elements = tempDiv.querySelectorAll('h3');
      const pElements = tempDiv.querySelectorAll('p');
      const commentDivs = tempDiv.querySelectorAll('div[style*="padding: 4px 0"]');
      
      // Process heading 1 elements
      h1Elements.forEach(el => {
        markdown += `# ${el.textContent}\n\n`;
      });
      
      // Process heading 2 elements
      h2Elements.forEach(el => {
        markdown += `## ${el.textContent}\n\n`;
      });
      
      // Process heading 3 elements (for comments section)
      h3Elements.forEach(el => {
        markdown += `### ${el.textContent}\n\n`;
      });
      
      // Process paragraph elements with improved formatting
      // Group paragraphs that look like they belong together
      const paragraphs: string[] = [];
      pElements.forEach(el => {
        // Skip empty paragraphs or those inside comment sections
        if (el.textContent?.trim() && !el.closest('div[style*="padding: 4px 0"]')) {
          paragraphs.push(el.textContent.trim());
        }
      });
      
      // Consolidate paragraphs to avoid excessive line breaks
      let currentParagraph = "";
      let paragraphWordCount = 0;
      const targetWordsPerParagraph = 50; // Aim for this many words per paragraph
      
      paragraphs.forEach((para) => {
        const words = para.split(/\s+/);
        
        // Special case for metadata lines (contain ":" or are very short)
        if (para.includes(":") || words.length < 5) {
          // Flush current paragraph if not empty
          if (currentParagraph) {
            markdown += `${currentParagraph}\n\n`;
            currentParagraph = "";
            paragraphWordCount = 0;
          }
          markdown += `${para}\n\n`;
          return;
        }
        
        // If adding this would make paragraph too long, start a new one
        if (paragraphWordCount + words.length > targetWordsPerParagraph && currentParagraph) {
          markdown += `${currentParagraph}\n\n`;
          currentParagraph = para;
          paragraphWordCount = words.length;
        } else {
          // Add to current paragraph with space if not empty
          if (currentParagraph) {
            currentParagraph += " " + para;
          } else {
            currentParagraph = para;
          }
          paragraphWordCount += words.length;
        }
      });
      
      // Add any remaining paragraph text
      if (currentParagraph) {
        markdown += `${currentParagraph}\n\n`;
      }
      
      // Process comments in a more compact format
      if (commentDivs.length > 0) {
        // Add a section break before comments if not already there
        if (!markdown.endsWith("### All Comments")) {
          markdown += `\n\n`;
        }
        
        // Process each comment
        commentDivs.forEach((commentDiv) => {
          const authorInfoDiv = commentDiv.querySelector('div:first-child');
          const commentTextDiv = commentDiv.querySelector('div:nth-child(2)');
          
          if (authorInfoDiv && commentTextDiv) {
            const authorText = authorInfoDiv.textContent?.trim() || '';
            const commentText = commentTextDiv.textContent?.trim() || '';
            
            // Format as a compact comment
            markdown += `**${authorText}**\n${commentText}\n\n`;
          }
        });
      }
      
      // Create download link
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `youtube-transcript-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: "Downloaded",
        description: "Transcript and comments downloaded as markdown",
      });
    } catch (error) {
      console.error("Download error:", error);
      toast({
        title: "Error",
        description: "Failed to download transcript",
        variant: "destructive",
      });
    }
  };

  // Add a UUID validation function
  function isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  // Modify the createDirectDocument function to get the project ID automatically
  const createDirectDocument = async () => {
    // Get all URLs to process
    const urlsToProcess: string[] = [];
    
    // Try to get URLs from parent data first
    if (data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) {
      console.log('🔍 Found video URLs in parent data:', data.videoUrls);
      data.videoUrls.forEach((url: string) => {
        if (!urlsToProcess.includes(url)) {
          urlsToProcess.push(url);
        }
      });
    } 
    // If parent data doesn't have URLs, try using our local state
    else if (localVideoUrls && localVideoUrls.length > 0) {
      console.log('🔍 Using local video URLs as fallback:', localVideoUrls);
      localVideoUrls.forEach((url: string) => {
        if (!urlsToProcess.includes(url)) {
          urlsToProcess.push(url);
        }
      });
      
      // Also update parent data with our local state to keep in sync
      if (localVideoUrls.length > 0) {
        console.log('📤 Syncing parent data with local URLs before processing');
        const updatedData = { ...data, videoUrls: [...localVideoUrls] };
        updateData(updatedData);
      }
    } else {
      console.warn('⚠️ No video URLs found in any state:', { parentData: data?.videoUrls, localVideoUrls });
    }
    
    // Add current input URL if not empty and not already in the list
    if (videoUrl && extractYouTubeId(videoUrl) && !urlsToProcess.includes(videoUrl)) {
      urlsToProcess.push(videoUrl);
    }
    
    console.log('🔍 Starting createDirectDocument with URLs:', urlsToProcess);
    
    if (urlsToProcess.length === 0) {
      console.error('❌ No video URLs provided');
      
      // Make the input field flash red
      const input = document.querySelector('input[placeholder*="YouTube URL"]');
      if (input) {
        input.classList.add('border-red-500');
        setTimeout(() => input.classList.remove('border-red-500'), 1000);
      }
      
      toast({
        title: "No Videos",
        description: "Please add at least one YouTube video URL",
        variant: "destructive",
      });
      return;
    }
    
    // Check if userId is available
    if (!effectiveUserId) {
      console.error("❌ No user ID provided - can't create document");
      toast({
        title: "Error",
        description: "User authentication required to create documents",
        variant: "destructive",
      });
      return;
    }
    
    // Set loading state
    setIsProcessingTranscripts(true);
    setShowExtraButtons(false);
    console.log('🚀 Starting document creation with multiple videos:', urlsToProcess.length);

    try {
      // Create a notification for multiple videos
      if (urlsToProcess.length > 1) {
        toast({
          title: "Processing Multiple Videos",
          description: `Extracting transcripts and comments for ${urlsToProcess.length} videos`,
        });
      }
      
      // Initialize progress tracker
      setProcessingProgress({ current: 0, total: urlsToProcess.length });
      
      // Process all videos and combine their transcripts
      const videoResults = [];
      let combinedTranscript = '';
      let firstVideoMetadata = null;
      
      // Process each video one by one
      for (let i = 0; i < urlsToProcess.length; i++) {
        const url = urlsToProcess[i];
        // Update progress
        setProcessingProgress({ current: i + 1, total: urlsToProcess.length });
        
        const videoId = extractYouTubeId(url) || 'unknown';
        console.log(`🎬 Processing video ${i + 1}/${urlsToProcess.length}: ${videoId} from URL: ${url}`);
        
        // Show progress toast for multi-video processing
        if (urlsToProcess.length > 1) {
          toast({
            title: `Video ${i + 1} of ${urlsToProcess.length}`,
            description: `Processing ${videoId}...`,
          });
        }
        
        // Fetch video metadata if not already available
        let metadata = videoMetadata[videoId];
        if (!metadata) {
          metadata = await fetchVideoMetadata(url);
        }
        
        // Save the first video's metadata to use for the document title
        if (!firstVideoMetadata) {
          firstVideoMetadata = metadata;
        }
        
        // Fetch transcript
        try {
          const transcript = await getYoutubeTranscript(url);
          
          // Fetch comments for this video
          setIsLoadingComments(true);
          console.log(`🔄 Starting comment fetch for ${videoId}`);
          let comments = '<p><em>Loading comments...</em></p>';
          
          try {
            comments = await fetchAndFormatComments(url);
            console.log(`✅ Comments loaded for ${videoId}`);
          } catch (commentError) {
            console.error(`❌ Failed to fetch comments for ${videoId}:`, commentError);
            comments = '<p><em>Failed to load comments: ' + (commentError instanceof Error ? commentError.message : 'Unknown error') + '</em></p>';
          } finally {
            setIsLoadingComments(false);
          }
          
          // Add this video's data to our results
          videoResults.push({
            url,
            videoId,
            metadata,
            transcript,
            comments
          });
          
          // Add formatted transcript to the combined content
          if (metadata) {
            combinedTranscript += `<h2>${metadata.title}</h2>
<p><strong>Channel:</strong> ${metadata.channelTitle}</p>
<p><strong>Video ID:</strong> ${videoId}</p>
<p><strong>URL:</strong> <a href="https://www.youtube.com/watch?v=${videoId}">https://www.youtube.com/watch?v=${videoId}</a></p>
${transcript}

${comments}
<hr />`;
          } else {
            combinedTranscript += `<h2>YouTube Video (${videoId})</h2>
<p><strong>URL:</strong> <a href="https://www.youtube.com/watch?v=${videoId}">https://www.youtube.com/watch?v=${videoId}</a></p>
${transcript}

${comments}
<hr />`;
          }
          
          console.log(`✅ Processed video ${videoId}: ${transcript.length} characters with comments`);
        } catch (error) {
          const transcriptError = error as Error;
          console.error(`❌ Failed to fetch transcript for ${videoId}:`, transcriptError);
          
          // Try to at least fetch comments even if transcript fails
          setIsLoadingComments(true);
          let comments = '<p><em>Loading comments...</em></p>';
          try {
            comments = await fetchAndFormatComments(url);
            console.log(`✅ Comments loaded for ${videoId} (transcript failed)`);
          } catch (commentError) {
            console.error(`❌ Failed to fetch comments for ${videoId}:`, commentError);
            comments = '<p><em>Failed to load comments: ' + (commentError instanceof Error ? commentError.message : 'Unknown error') + '</em></p>';
          } finally {
            setIsLoadingComments(false);
          }
          
          // Add error note in the combined content
          combinedTranscript += `<h2>${metadata?.title || `YouTube Video (${videoId})`}</h2>
<p><strong>Error:</strong> Could not fetch transcript - ${transcriptError.message}</p>

${comments}
<hr />`;
        }
      }
      
      // If we have no successful transcripts, stop
      if (videoResults.length === 0) {
        setIsProcessingTranscripts(false);
        toast({
          title: "Error",
          description: "Could not fetch any transcripts",
          variant: "destructive",
        });
        return;
      }
      
      // Create document title based on number of videos
      let docTitle;
      if (videoResults.length === 1 && videoResults[0].metadata) {
        docTitle = `Transcript: ${videoResults[0].metadata.title}`;
      } else {
        docTitle = `Combined Transcripts: ${videoResults.length} Videos`;
      }
      
      // Create final document content
      const enrichedContent = `<h1>${videoResults.length > 1 ? 'Combined Transcripts' : (firstVideoMetadata?.title || 'YouTube Transcript')}</h1>
<p><strong>Videos:</strong> ${videoResults.length}</p>
<hr />
${combinedTranscript}`;
      
      // Format as rich HTML content
      const plainContent = enrichedContent;
      
      console.log(`📝 Content prepared - Length: ${plainContent.length} characters`);
      
      // Save transcript content for clipboard/download
      setTranscriptContent(plainContent);
      setShowExtraButtons(true);
      
      // DIRECT SUPABASE DOCUMENT CREATION
      console.log('💾 Creating document directly in Supabase...');
      
      // Get current project information from Supabase directly
      console.log('🔍 Getting current project information...');
      
      try {
        // Query to get current user's active projects
        const { data: currentProjects, error: projectsError } = await supabase
          .from('projects')
          .select('id, name, created_at')
          .order('created_at', { ascending: false })
          .limit(1);
        
        if (projectsError) {
          console.error("❌ Error fetching projects:", projectsError);
          throw new Error(`Couldn't get project info: ${projectsError.message}`);
        }
        
        if (!currentProjects || currentProjects.length === 0) {
          console.log("⚠️ No projects found in database, checking for current documents...");
          
          // Try to get project ID from an existing document
          const { data: existingDocs, error: docsError } = await supabase
            .from('documents')
            .select('project_id')
            .limit(1);
          
          if (docsError || !existingDocs || existingDocs.length === 0) {
            console.log("⚠️ No project ID found from existing documents, using default project ID");
            console.log(`🧪 Using fallback project ID: ${effectiveProjectId}`);
            // Use the effective project ID as fallback
            const doc = await createDocumentWithProjectId(effectiveProjectId, docTitle, plainContent);
            
            if (doc && Array.isArray(doc)) {
              // If it's an array, use the first element
              setLastCreatedDocId(doc[0]?.id || null);
              setLastCreatedDocContent(plainContent);
              
              // Show a toast that analysis is now available
              toast({
                title: "Document Created",
                description: "Document created successfully. You can now analyze it with AI.",
              });
            } else if (doc) {
              // If it's a single object
              setLastCreatedDocId(doc.id || null);
              setLastCreatedDocContent(plainContent);
              
              // Show a toast that analysis is now available
              toast({
                title: "Document Created",
                description: "Document created successfully. You can now analyze it with AI.",
              });
            }
          }
          
          // Use project ID from existing document
          if (existingDocs && existingDocs.length > 0 && existingDocs[0]?.project_id) {
            const foundProjectId = existingDocs[0].project_id;
            console.log(`✅ Found project ID from existing document: ${foundProjectId}`);
            
            // Create document with this project ID
            const doc = await createDocumentWithProjectId(foundProjectId, docTitle, plainContent);
            
            if (doc && Array.isArray(doc)) {
              // If it's an array, use the first element
              setLastCreatedDocId(doc[0]?.id || null);
              setLastCreatedDocContent(plainContent);
              
              // Show a toast that analysis is now available
              toast({
                title: "Document Created",
                description: "Document created successfully. You can now analyze it with AI.",
              });
            } else if (doc) {
              // If it's a single object
              setLastCreatedDocId(doc.id || null);
              setLastCreatedDocContent(plainContent);
              
              // Show a toast that analysis is now available
              toast({
                title: "Document Created",
                description: "Document created successfully. You can now analyze it with AI.",
              });
            }
          } else {
            console.warn("No existing documents found to extract project ID");
            // Use first project ID as fallback
          }
        } else {
          // Use first project ID
          const foundProjectId = currentProjects[0].id;
          console.log(`✅ Found project ID from projects table: ${foundProjectId}`);
          
          // Create document with this project ID
          const doc = await createDocumentWithProjectId(foundProjectId, docTitle, plainContent);
          
          if (doc && Array.isArray(doc)) {
            // If it's an array, use the first element
            setLastCreatedDocId(doc[0]?.id || null);
            setLastCreatedDocContent(plainContent);
            
            // Show a toast that analysis is now available
            toast({
              title: "Document Created",
              description: "Document created successfully. You can now analyze it with AI.",
            });
          } else if (doc) {
            // If it's a single object
            setLastCreatedDocId(doc.id || null);
            setLastCreatedDocContent(plainContent);
            
            // Show a toast that analysis is now available
            toast({
              title: "Document Created",
              description: "Document created successfully. You can now analyze it with AI.",
            });
          }
        }
      } catch (projectError) {
        console.error("❌ Error finding project ID:", projectError);
        
        // Final fallback - try to use the documents list endpoint
        try {
          console.log("📄 Attempting to create document using documents API...");
          
          // Prepare document data without explicit project_id
          const documentData = {
            title: docTitle,
            type: "research",
            content: plainContent,
            user_id: effectiveUserId,
            project_id: effectiveProjectId, // Add the fallback project ID
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          
          console.log('📄 Document data for fallback method:', JSON.stringify(documentData, null, 2));
          
          // Insert document and let Supabase server-side logic handle the project assignment
          const { data: newDoc, error } = await supabase
            .from("documents")
            .insert(documentData)
            .select();
          
          if (error) {
            console.error("❌ Fallback document creation error:", error);
            console.error("❌ Error details:", JSON.stringify(error, null, 2));
            throw new Error(`Database insert error: ${error.message}`);
          }
          
          if (!newDoc || newDoc.length === 0) {
            console.error("❌ No document data returned from fallback method");
            throw new Error("Document creation failed - no data returned");
          }
          
          console.log(`✅ Document created with fallback method:`, newDoc);
          
          if (newDoc && Array.isArray(newDoc)) {
            // If it's an array, use the first element
            setLastCreatedDocId(newDoc[0]?.id || null);
            setLastCreatedDocContent(plainContent);
            
            // Show a toast that analysis is now available
            toast({
              title: "Document Created",
              description: "Document created successfully. You can now analyze it with AI.",
            });
          } else if (newDoc) {
            // If it's a single object
            // Ensure newDoc has an id property before accessing it
            const docId = typeof newDoc === 'object' && newDoc !== null && 'id' in newDoc 
              ? (newDoc as { id: string }).id 
              : null;
            
            setLastCreatedDocId(docId);
            setLastCreatedDocContent(plainContent);
            
            // Show a toast that analysis is now available
            toast({
              title: "Document Created",
              description: "Document created successfully. You can now analyze it with AI.",
            });
          }
        } catch (fallbackError) {
          throw new Error(`All document creation methods failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
      }
    } catch (error) {
      console.error("🚨 Error creating direct document:", error);
      toast({
        title: "Error",
        description: `Failed to create document: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsProcessingTranscripts(false);
    }
  };
  
  // Helper function to clean up transcript content with better formatting
  const cleanupTranscriptContent = (content: string): string => {
    // Use DOM parser to manipulate the HTML content
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    
    // Get all paragraph elements and clean them up
    const paragraphs = doc.querySelectorAll('p');
    
    // Join short paragraphs that should be together
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      const text = para.textContent || '';
      
      // Skip metadata paragraphs (contain ":" or are very short)
      if (text.includes(':') || text.length < 15) {
        continue;
      }
      
      // Look ahead for short paragraphs that could be merged
      if (i < paragraphs.length - 1) {
        const nextPara = paragraphs[i + 1];
        const nextText = nextPara.textContent || '';
        
        // If next paragraph is short, merge them
        if (nextText.length < 50 && !nextText.includes(':')) {
          para.textContent = text + ' ' + nextText;
          nextPara.textContent = '';
        }
      }
    }
    
    // Serialize back to HTML
    return doc.body.innerHTML;
  };
  
  // Helper function to create document with a specific project ID
  const createDocumentWithProjectId = async (projectId: string, title: string, content: string): Promise<any> => {
    console.log(`Creating document for project ${projectId}: "${title}" (${content.length} chars)`);
    
    if (!effectiveUserId) {
      throw new Error("User ID is required to create documents");
    }

    try {
      // Clean up the transcript content for better formatting
      const cleanedContent = cleanupTranscriptContent(content);
      
      // Create in database
      const { data, error } = await supabase
        .from("documents")
        .insert({
          title,
          type: "research",
          content: cleanedContent,
          project_id: projectId,
          user_id: effectiveUserId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select();

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Failed to create document: No data returned");
      }
      
      console.log(`Document created successfully:`, data[0]);
      
      // Return the newly created document
      return data[0];
    } catch (error) {
      console.error("Error creating document:", error);
      toast({
        title: "Document Creation Failed",
        description: `Could not create document: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
      throw error;
    }
  };

  // Function to fetch and format YouTube comments
  const fetchAndFormatComments = async (url: string): Promise<string> => {
    try {
      const videoId = extractYouTubeId(url);
      if (!videoId) {
        return '<p><em>Could not extract video ID from URL to fetch comments.</em></p>';
      }
      
      console.log(`💬 Fetching ALL comments for video: ${videoId}`);
      
      // Show progress toast for longer operations
      toast({
        title: "Fetching Comments",
        description: `Getting comments for video ${videoId.substring(0, 5)}...`,
      });
      
      // Call our server endpoint to get all comments with pagination
      const response = await fetch('/api/youtube/all-comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoUrl: url }),
      });
      
      if (!response.ok) {
        console.error(`🚨 Failed to fetch comments: ${response.status}`);
        return '<p><em>Failed to load comments for this video (Status: ' + response.status + ').</em></p>';
      }
      
      const data = await response.json();
      const comments = data.comments;
      
      if (!comments || comments.length === 0) {
        console.log('⚠️ No comments found or unable to fetch comments');
        return '<p><em>No comments available for this video.</em></p>';
      }
      
      console.log(`✅ Received ${comments.length} comments` + (data.simulated ? ' (simulated)' : ''));
      toast({
        title: "Comments Retrieved",
        description: `Successfully loaded ${comments.length} comments${data.partial ? ' (partial)' : ''}`,
      });
      
      // Format comments as HTML with better styling - more compact layout
      let formattedComments = `<h3>All Comments (${comments.length}${data.partial ? '+' : ''})</h3>`;
      
      // Create a compact table-like structure for comments
      formattedComments += `<div style="font-size: 0.9em;">`;
      
      comments.forEach((comment: any, index: number) => {
        // Format the date nicely
        const date = new Date(comment.publishedAt).toLocaleDateString(undefined, {
          year: 'numeric', 
          month: 'short', 
          day: 'numeric'
        });
        
        // Clean up HTML in comment text (remove script tags, etc.)
        const cleanText = comment.textDisplay
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/\n\n+/g, '\n')  // Reduce multiple newlines to single newline
          .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br/>') // Remove double breaks
          .trim();
          
        // More compact comment display
        formattedComments += `
<div style="padding: 4px 0; border-bottom: 1px solid #eee; margin-bottom: 4px;">
  <div><strong>${comment.authorDisplayName}</strong> · <span style="color: #6b7280;">${date}</span> · 👍 ${comment.likeCount}</div>
  <div style="margin: 2px 0 0 10px;">${cleanText}</div>
</div>`;
      });
      
      if (data.partial) {
        formattedComments += `<div style="padding: 8px 0; text-align: center; font-style: italic; color: #6b7280;">
  Note: Only showing ${comments.length} comments. The video may have more comments than could be retrieved.
</div>`;
      }
      
      formattedComments += `</div>`;
      
      return formattedComments;
    } catch (error) {
      console.error('Error fetching comments:', error);
      return '<p><em>Failed to load comments for this video.</em></p>';
    }
  };

  // Improve the analyzeWithAI function to work with the created document and add more logging
  const analyzeWithAI = async () => {
    console.log("🔍 Analyze with AI button clicked");
    
    // Track that button was clicked
    setAiDebugInfo(prev => ({ 
      ...prev, 
      buttonClicked: true,
      timestamp: new Date().toISOString()
    }));
    
    // Check if API key is available first
    const hasApiKey = typeof window !== 'undefined' && 
      (localStorage.getItem('OPENAI_API_KEY') || 
       process.env.NEXT_PUBLIC_OPENAI_API_KEY);
    
    console.log("🔑 API Key status:", hasApiKey ? "Found" : "Missing");
    
    // Update debug info with API key status
    setAiDebugInfo(prev => ({ 
      ...prev, 
      apiKeyStatus: hasApiKey ? 'Found' : 'Missing'
    }));
    
    if (!hasApiKey) {
      console.log("❌ No API key found");
      setAiDebugInfo(prev => ({ 
        ...prev, 
        error: 'OpenAI API key not configured'
      }));
      
      // Offer to redirect to API settings
      toast({
        title: "API Key Required",
        description: "You need to configure your OpenAI API key before using AI analysis.",
        action: (
          <div className="flex gap-1 mt-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                // Store current URLs to preserve state
                if (localVideoUrls.length > 0) {
                  localStorage.setItem('temp_video_urls', JSON.stringify(localVideoUrls));
                }
                
                // Redirect to API settings - assumes you have an API settings route
                alert("Please add your OpenAI API key in the API settings.");
                // Ideally navigate to API settings page:
                // window.location.href = '/settings/api';
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              Configure API Key
            </Button>
          </div>
        ),
      });
      return;
    }
    
    // Set loading state
    setIsAnalyzing(true);
    console.log("🔄 Setting isAnalyzing to true");
    
    try {
      let contentToAnalyze: string;
      
      // Check if we have a recently created document content
      if (lastCreatedDocContent) {
        console.log("✅ Using content from last created document:", lastCreatedDocContent.substring(0, 100) + "...");
        contentToAnalyze = lastCreatedDocContent;
      } else {
        console.log("⚠️ No recent document found, fetching content from URLs");
        
        // Get all URLs and content to process
        const urlsToProcess: string[] = [];
        
        // Try to get URLs from parent data first
        if (data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) {
          console.log("📋 Found URLs in parent data:", data.videoUrls);
          data.videoUrls.forEach((url: string) => {
            if (!urlsToProcess.includes(url)) {
              urlsToProcess.push(url);
            }
          });
        } 
        // If parent data doesn't have URLs, try using our local state
        else if (localVideoUrls && localVideoUrls.length > 0) {
          console.log("📋 Found URLs in local state:", localVideoUrls);
          localVideoUrls.forEach((url: string) => {
            if (!urlsToProcess.includes(url)) {
              urlsToProcess.push(url);
            }
          });
        }
        
        console.log("🔢 Total URLs to process:", urlsToProcess.length);
        
        if (urlsToProcess.length === 0) {
          console.log("❌ No URLs to process");
          toast({
            title: "No Videos",
            description: "Please create a document first using the 'Create Document' button.",
            variant: "destructive",
          });
          setIsAnalyzing(false);
          setAiDebugInfo(prev => ({ 
            ...prev, 
            error: 'No videos to analyze'
          }));
          return;
        }
        
        // Process all videos and combine their transcripts
        contentToAnalyze = '';
        
        toast({
          title: "AI Analysis",
          description: "Gathering video content for analysis...",
        });
        
        // Process content from URLs (this can be slow)
        for (let i = 0; i < urlsToProcess.length; i++) {
          const url = urlsToProcess[i];
          const videoId = extractYouTubeId(url) || 'unknown';
          console.log(`🎬 Processing video ${i+1}/${urlsToProcess.length}: ${videoId}`);
          
          // Update progress for multiple videos
          if (urlsToProcess.length > 1) {
            setProcessingProgress({ current: i + 1, total: urlsToProcess.length });
          }
          
          // Fetch transcript
          try {
            console.log(`🔄 Fetching transcript for ${videoId}...`);
            const transcript = await getYoutubeTranscript(url);
            console.log(`✅ Transcript received for ${videoId}: ${transcript.length} characters`);
            
            // Fetch metadata if not already available
            let metadata = videoMetadata[videoId];
            if (!metadata) {
              console.log(`🔄 Fetching metadata for ${videoId}...`);
              metadata = await fetchVideoMetadata(url);
              console.log(`✅ Metadata received for ${videoId}:`, metadata);
            }
            
            // Add formatted content
            contentToAnalyze += `Video: ${metadata?.title || 'Unknown'}\n`;
            contentToAnalyze += `URL: https://www.youtube.com/watch?v=${videoId}\n`;
            contentToAnalyze += `Transcript:\n${stripHtml(transcript)}\n\n`;
            
          } catch (error) {
            console.error(`❌ Failed to fetch transcript for ${videoId}:`, error);
            contentToAnalyze += `Error processing video ${videoId}: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
            setAiDebugInfo(prev => ({ 
              ...prev, 
              error: `Transcript error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }));
          }
        }
      }
      
      // Show AI analysis is starting
      console.log("🧠 Starting AI analysis with content length:", contentToAnalyze.length);
      toast({
        title: "Starting AI Analysis",
        description: "Sending content to AI for analysis...",
      });
      
      // Update debug when trying to analyze content
      setAiDebugInfo(prev => ({ 
        ...prev, 
        contentAnalyzed: true
      }));
      
      console.log("🔄 Calling OpenAI API...");
      
      // Send to OpenAI for analysis
      const analysis = await analyzeVideoContent(contentToAnalyze);
      console.log("✅ Analysis received from OpenAI:", analysis);
      setAnalysisResult(analysis);
      
      // Show success toast
      toast({
        title: "Analysis Complete",
        description: "AI analysis of video content is ready",
      });
      
    } catch (error) {
      console.error("❌ Error in AI analysis:", error);
      setAiDebugInfo(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
      toast({
        title: "Analysis Error",
        description: `Error analyzing content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      console.log("🔄 Setting isAnalyzing to false");
      setIsAnalyzing(false);
    }
  };
  
  // Save AI analysis as a document
  const saveAnalysisAsDocument = async (content: string) => {
    if (!effectiveUserId) {
      toast({
        title: "Error",
        description: "User authentication required to create documents",
        variant: "destructive",
      });
      return;
    }
    
    // Create document title based on first video if available
    let docTitle = "AI Video Analysis";
    const firstUrl = localVideoUrls[0] || (data?.videoUrls && data.videoUrls[0]);
    
    if (firstUrl) {
      const videoId = extractYouTubeId(firstUrl);
      if (videoId && videoMetadata[videoId]?.title) {
        docTitle = `Analysis: ${videoMetadata[videoId].title}`;
      }
    }
    
    try {
      // Create the document
      let newDocument;
      
      if (createDocument && typeof createDocument === 'function') {
        newDocument = await createDocument("research", docTitle, content);
        
        toast({
          title: "Document Created",
          description: `AI analysis saved as "${docTitle}"`,
        });
      } else if (effectiveProjectId) {
        // Use alternative document creation method if createDocument isn't available
        newDocument = await createDocumentWithProjectId(effectiveProjectId, docTitle, content);
        
        toast({
          title: "Document Created",
          description: `AI analysis saved to "${docTitle}"`,
        });
      }
      
      // Close analysis modal
      setAnalysisResult(null);
      
    } catch (error) {
      console.error("Error saving analysis as document:", error);
      toast({
        title: "Save Error",
        description: `Could not save analysis: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    }
  };
  
  // Utility function to strip HTML tags
  const stripHtml = (html: string) => {
    const tmp = document.createElement('DIV');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };
  
  // Utility function to escape HTML for display
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const [currentVideoThumbnail, setCurrentVideoThumbnail] = useState<string | null>(null);
  const [currentVideoTitle, setCurrentVideoTitle] = useState<string | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Toast hook for notifications
  const { toast } = useToast();

  // Add a function to directly test the AI analysis
  const testAiAnalysis = async () => {
    console.log("🧪 Testing AI analysis function...");
    
    // Update debug info
    setAiDebugInfo(prev => ({ 
      ...prev, 
      buttonClicked: true,
      timestamp: new Date().toISOString(),
      error: null
    }));
    
    // Check for API key
    const apiKey = typeof window !== 'undefined' && 
      (localStorage.getItem('OPENAI_API_KEY') || 
      process.env.NEXT_PUBLIC_OPENAI_API_KEY);
      
    setAiDebugInfo(prev => ({ 
      ...prev, 
      apiKeyStatus: apiKey ? 'Found' : 'Missing'
    }));
    
    if (!apiKey) {
      console.log("❌ No API key found during test");
      setAiDebugInfo(prev => ({ 
        ...prev, 
        error: 'OpenAI API key not configured'
      }));
      return;
    }
    
    console.log("✅ API key found");
    
    // Test with sample content
    try {
      console.log("🔄 Testing with sample content...");
      const testContent = "This is a test of the AI analysis functionality.";
      
      setAiDebugInfo(prev => ({ 
        ...prev, 
        contentAnalyzed: true
      }));
      
      // Create a simple alert with status
      alert(`
Test Results:
- API Key: ✅ Found (${apiKey.substring(0, 3)}...)
- Button Clicked: ✅ Yes
- Content Ready: ✅ Yes

Now sending test request to OpenAI...
      `);
      
      try {
        // Attempt to make a minimal API call to verify the key works
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: "You are a helpful assistant."
              },
              {
                role: "user",
                content: "Test API connection with a short response."
              }
            ],
            temperature: 0.7,
            max_tokens: 50
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log("✅ OpenAI API test successful!", data);
          alert("OpenAI API test successful! API key is working.");
        } else {
          const errorData = await response.json();
          console.error("❌ OpenAI API test failed:", errorData);
          alert(`OpenAI API test failed: ${errorData.error?.message || 'Unknown error'}`);
          setAiDebugInfo(prev => ({ 
            ...prev, 
            error: `API Error: ${errorData.error?.message || 'Unknown OpenAI API error'}`
          }));
        }
      } catch (apiError) {
        console.error("❌ Error during API test:", apiError);
        alert(`Error during API test: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`);
        setAiDebugInfo(prev => ({ 
          ...prev, 
          error: `API Error: ${apiError instanceof Error ? apiError.message : 'Unknown error'}`
        }));
      }
    } catch (error) {
      console.error("❌ Test error:", error);
      setAiDebugInfo(prev => ({ 
        ...prev, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden p-4">
      {/* Header with title and mobile menu toggle */}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Youtube className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold">Video Research Tool</h2>
            
            {/* Add debug toggle button */}
            <button
              onClick={() => setShowDebugPanel(!showDebugPanel)}
              className="ml-2 px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-full"
              title="Toggle Debug Panel"
            >
              {showDebugPanel ? "Hide Debug" : "Show Debug"}
            </button>
          </div>
          
          <button
            className="md:hidden p-2 rounded-md hover:bg-gray-800"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            <AlignJustify className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Processing overlay */}
      {isProcessingTranscripts && (
        <div className="fixed inset-0 bg-black/40 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-gray-800 rounded-lg p-4 shadow-lg border border-gray-700 flex items-center space-x-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
            <div>
              <p className="text-sm font-medium text-gray-200">
                {isLoadingComments ? 
                  "Fetching comments..." : 
                  processingProgress.total > 1 ? 
                    `Processing video ${processingProgress.current} of ${processingProgress.total}` : 
                    "Creating document..."}
              </p>
              <p className="text-xs text-gray-400">Please wait, this may take a moment</p>
            </div>
          </div>
        </div>
      )}

      {/* Debug panel */}
      <div className="mb-2">
        <button 
          onClick={() => setShowDebugPanel(!showDebugPanel)}
          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded flex items-center gap-1"
        >
          {showDebugPanel ? (
            <>
              <span>Hide Debug Info</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
            </>
          ) : (
            <>
              <span>Show Debug Info</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </button>
      </div>

      {showDebugPanel && (
        <div className="bg-gray-800/50 p-3 text-xs rounded-md border border-gray-700 mb-3">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <div className="text-gray-400">Debug: Input URL = <span className="text-gray-200">"{videoUrl}"</span> (Length: {videoUrl?.length || 0}) {extractYouTubeId(videoUrl) ? '✅' : '❌'}</div>
              <div className="text-gray-400">Parent data.videoUrls = <span className="text-gray-200">{data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0 
                ? `${data.videoUrls.length} videos` 
                : 'Empty'}</span></div>
              <div className="text-gray-400">Local videoUrls = <span className="text-gray-200">{localVideoUrls && localVideoUrls.length > 0 
                ? `${localVideoUrls.length} videos (${localVideoUrls.join(', ').substring(0, 30)}${localVideoUrls.join(', ').length > 30 ? '...' : ''})` 
                : 'Empty'}</span></div>
              <div className="text-gray-400">Button State: <span className="text-gray-200">{isProcessingTranscripts 
                ? '❌ Processing' 
                : (!(data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) && 
                  !(localVideoUrls && localVideoUrls.length > 0))
                  ? '❌ Disabled (No Videos)' 
                  : '✅ Ready'}</span></div>
              <div className="text-gray-400">Sync Status: <span className="text-gray-200">{
                (!data?.videoUrls || !Array.isArray(data.videoUrls)) ? '⚠️ Parent data invalid' :
                (!localVideoUrls || localVideoUrls.length === 0) && data.videoUrls.length === 0 ? '✅ Both empty' :
                data.videoUrls.length === localVideoUrls.length && 
                JSON.stringify(data.videoUrls.sort()) === JSON.stringify(localVideoUrls.sort()) ? 
                '✅ Synchronized' : 
                '❌ Out of sync'
              }</span></div>
            </div>
            
            <button 
              onClick={() => {
                console.log('🔧 Manual restore triggered');
                if (localVideoUrls.length > 0) {
                  const updatedData = JSON.parse(JSON.stringify(data || {}));
                  updatedData.videoUrls = [...localVideoUrls];
                  
                  if (!updatedData.videoMetadata) {
                    updatedData.videoMetadata = {};
                  }
                  
                  updateData(updatedData);
                  toast({
                    title: "Debug: State Restored",
                    description: `Restored ${localVideoUrls.length} videos from local state`,
                  });
                } else {
                  toast({
                    title: "Debug: Nothing to Restore",
                    description: "No videos in local state",
                    variant: "destructive",
                  });
                }
              }}
              className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            >
              Force State Restore
            </button>
          </div>
        </div>
      )}

      {showDebugPanel && (
        <div className="mt-4 p-4 bg-gray-800 rounded-md border border-gray-700 text-xs font-mono">
          <h4 className="font-bold mb-2 text-gray-300">Debug Information</h4>
          
          {/* Existing debug info... */}
          
          {/* Add AI Debug Section */}
          <div className="mt-3 pb-2 border-t border-gray-700 pt-2">
            <h5 className="font-bold text-blue-400 mb-1">AI Analysis Debug:</h5>
            <div className="grid grid-cols-2 gap-x-2">
              <div className="text-gray-400">Button Clicked:</div>
              <div className={aiDebugInfo.buttonClicked ? "text-green-400" : "text-red-400"}>
                {aiDebugInfo.buttonClicked ? "Yes" : "No"}
              </div>
              
              <div className="text-gray-400">API Key Status:</div>
              <div className={aiDebugInfo.apiKeyStatus === 'Found' ? "text-green-400" : "text-red-400"}>
                {aiDebugInfo.apiKeyStatus}
              </div>
              
              <div className="text-gray-400">Content Analyzed:</div>
              <div className={aiDebugInfo.contentAnalyzed ? "text-green-400" : "text-red-400"}>
                {aiDebugInfo.contentAnalyzed ? "Yes" : "No"}
              </div>
              
              <div className="text-gray-400">Last Error:</div>
              <div className="text-red-400">
                {aiDebugInfo.error || "None"}
              </div>
              
              <div className="text-gray-400">Last Attempt:</div>
              <div className="text-gray-300">
                {aiDebugInfo.timestamp ? new Date(aiDebugInfo.timestamp).toLocaleTimeString() : "Never"}
              </div>
            </div>
            
            <div className="mt-2">
              <button
                onClick={() => {
                  console.log('Testing OpenAI API key...');
                  const apiKey = typeof window !== 'undefined' && 
                    (localStorage.getItem('OPENAI_API_KEY') || 
                    process.env.NEXT_PUBLIC_OPENAI_API_KEY);
                  
                  setAiDebugInfo(prev => ({ 
                    ...prev, 
                    apiKeyStatus: apiKey ? 'Found' : 'Missing',
                    buttonClicked: true,
                    timestamp: new Date().toISOString()
                  }));
                  
                  alert(`OpenAI API Key status: ${apiKey ? 'Found' : 'Missing'}\nKey: ${apiKey ? apiKey.substring(0, 5) + '...' : 'Not configured'}`);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded px-2 py-1 text-xs mt-1"
              >
                Test API Key
              </button>
              
              <button
                onClick={testAiAnalysis}
                className="bg-green-600 hover:bg-green-700 text-white rounded px-2 py-1 text-xs mt-1 ml-2"
              >
                Test AI Analysis
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video input section */}
      <div className="space-y-3">
        <div className="flex flex-col space-y-1">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium text-gray-300">Video Source</h3>
            <span className="text-xs text-gray-500">Add YouTube videos to research</span>
          </div>
          <div className="flex items-center space-x-2">
            <Input
              type="text"
              placeholder="Paste YouTube URL here (e.g., https://youtu.be/...)"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="flex-1 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-800/50 text-sm"
              autoFocus
            />
            <Button 
              onClick={addVideo} 
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 h-9 rounded transition-colors"
            >
              Add
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Add multiple URLs to extract transcripts and comments from several videos at once
          </p>
        </div>

        {/* Videos list with thumbnails */}
        {((data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) || 
          (localVideoUrls && localVideoUrls.length > 0)) && (
          <div className="mt-4">
            <div className="flex items-center mb-3">
              <h3 className="text-sm font-medium text-gray-300">
                Videos to analyze
              </h3>
              <div className="ml-2.5 px-2 py-0.5 bg-gray-800 rounded-full flex items-center">
                <span className="text-sm font-medium text-green-500">
                  {(data?.videoUrls && Array.isArray(data.videoUrls)) ? data.videoUrls.length : localVideoUrls.length}
                </span>
                <svg className="w-4 h-4 ml-1 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
            </div>

            <div className="space-y-2.5">
              {((data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) 
                ? data.videoUrls 
                : localVideoUrls).map((url: string, index: number) => {
                const videoId = extractYouTubeId(url);
                const metadata = getMetadataForUrl(url);
                
                return (
                  <div 
                    key={url} 
                    className="flex items-center justify-between p-2.5 rounded-md bg-gray-800/80 hover:bg-gray-700/80 transition-all duration-150 border border-gray-700 hover:border-gray-600 shadow-sm"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      {/* Video number badge */}
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600/90 flex items-center justify-center text-xs font-medium text-white">
                        {index + 1}
                      </div>

                      {/* Thumbnail */}
                      <div className="relative h-12 w-20 flex-shrink-0 rounded overflow-hidden shadow-sm">
                        <img 
                          src={metadata?.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/default.jpg`}
                          alt="Video thumbnail"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      
                      {/* Video info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200 truncate">
                          {metadata?.title || url}
                        </p>
                        {metadata?.channelTitle && (
                          <p className="text-xs text-gray-400 truncate">
                            {metadata.channelTitle}
                          </p>
                        )}
                      </div>
                    </div>
                    
                    {/* Delete button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeVideo(url)}
                      className="h-7 w-7 rounded-full hover:bg-gray-600/80 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col space-y-2">
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-700 mt-4">
          <Button
            variant="default"
            onClick={createDirectDocument}
            className="bg-red-600 hover:bg-red-700 text-sm text-white px-3 py-1.5 h-8 rounded transition-colors flex items-center space-x-1.5"
            disabled={isProcessingTranscripts || 
                     (!(data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) && 
                      !(localVideoUrls && localVideoUrls.length > 0))}
          >
            <Database className="h-3.5 w-3.5" />
            {isProcessingTranscripts && !isAnalyzing ? (
              <span>
                {isLoadingComments ? 
                  "Fetching Comments..." : 
                  processingProgress.total > 1 ? 
                    `Processing ${processingProgress.current}/${processingProgress.total}` : 
                    "Creating Document..."}
              </span>
            ) : (
              <span>Create Document</span>
            )}
          </Button>
          
          {/* Analyze with AI button */}
          <Button
            variant="default"
            onClick={analyzeWithAI}
            className="bg-violet-600 hover:bg-violet-700 text-sm text-white px-3 py-1.5 h-8 rounded transition-colors flex items-center space-x-1.5"
            disabled={isProcessingTranscripts || 
                     (!(data?.videoUrls && Array.isArray(data.videoUrls) && data.videoUrls.length > 0) && 
                      !(localVideoUrls && localVideoUrls.length > 0))}
          >
            <Bot className="h-3.5 w-3.5" />
            {isAnalyzing ? (
              <span>Analyzing...</span>
            ) : (
              <span>Analyze with AI</span>
            )}
          </Button>
        </div>
        
        {showExtraButtons && (
          <div className="flex space-x-2 mt-2">
            <Button 
              variant="secondary"
              onClick={copyToClipboard}
              className="border-gray-600 bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 px-3 py-1.5 h-8 rounded transition-colors flex items-center space-x-1.5"
            >
              <Clipboard className="h-3.5 w-3.5" />
              <span>Copy to Clipboard</span>
            </Button>
            
            <Button 
              variant="secondary"
              onClick={downloadAsMarkdown}
              className="border-gray-600 bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 px-3 py-1.5 h-8 rounded transition-colors flex items-center space-x-1.5"
            >
              <FileDown className="h-3.5 w-3.5" />
              <span>Download as Markdown</span>
            </Button>
          </div>
        )}
      </div>

      {/* Transcript display area */}
      {transcriptContent && (
        <div className="mt-4 p-4 bg-gray-800/50 rounded-md border border-gray-700">
          <div dangerouslySetInnerHTML={{ __html: transcriptContent }} />
        </div>
      )}

      {/* AI Analysis results modal */}
      {analysisResult && (
        <VideoAnalysisResult 
          analysis={analysisResult} 
          onClose={() => setAnalysisResult(null)}
          onSaveAsDocument={saveAnalysisAsDocument}
        />
      )}
    </div>
  );
}