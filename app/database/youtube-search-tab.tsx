"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertCircle, Database, ExternalLink, RefreshCw, Youtube, Check } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { ProcessingImportDialog } from "./import-results-dialog";

interface YouTubeSearchTabProps {
  onImportComplete: (results: any) => void;
  chunkingMethod: string;
  processMode: 'full' | 'metadata';
}

export default function YouTubeSearchTab({ onImportComplete, chunkingMethod, processMode }: YouTubeSearchTabProps) {
  const { toast } = useToast();
  
  // State for YouTube search
  const [youtubeSearchTerm, setYoutubeSearchTerm] = useState("");
  const [youtubeSearchResults, setYoutubeSearchResults] = useState<any[]>([]);
  const [youtubeSearching, setYoutubeSearching] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [selectedYoutubeVideos, setSelectedYoutubeVideos] = useState<Set<string>>(new Set());
  const [importingVideos, setImportingVideos] = useState(false);
  const [importResults, setImportResults] = useState<any | null>(null);
  const [showImportResults, setShowImportResults] = useState(false);
  // Add state to track videos that already exist in the database
  const [existingVideos, setExistingVideos] = useState<Record<string, boolean>>({});
  const [checkingExistence, setCheckingExistence] = useState(false);
  // Add state for showing processing dialog
  const [showProcessingDialog, setShowProcessingDialog] = useState(false);
  
  // Function to search YouTube
  const searchYoutube = async () => {
    if (!youtubeSearchTerm.trim()) return;
    
    try {
      setYoutubeError(null);
      setYoutubeSearching(true);
      
      const response = await fetch("/api/youtube/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: youtubeSearchTerm }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to search YouTube");
      }
      
      const data = await response.json();
      setYoutubeSearchResults(data.videos || []);
      
      // After getting search results, check which videos already exist in the database
      if (data.videos && data.videos.length > 0) {
        checkExistingVideos(data.videos.map((v: any) => v.id));
      }
    } catch (error) {
      console.error("Error searching YouTube:", error);
      setYoutubeError(error instanceof Error ? error.message : "Failed to search YouTube");
    } finally {
      setYoutubeSearching(false);
    }
  };
  
  // New function to check which videos already exist in the database
  const checkExistingVideos = async (videoIds: string[]) => {
    try {
      setCheckingExistence(true);
      
      const response = await fetch("/api/vector/check-videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to check videos");
      }
      
      const data = await response.json();
      setExistingVideos(data.results || {});
      
      // Count how many videos already exist
      const existingCount = Object.values(data.results).filter(Boolean).length;
      if (existingCount > 0) {
        toast({
          title: "Database Check",
          description: `${existingCount} of the ${videoIds.length} videos are already in your database.`,
        });
      }
    } catch (error) {
      console.error("Error checking existing videos:", error);
      // Don't show error toast here, just log it
    } finally {
      setCheckingExistence(false);
    }
  };
  
  // Toggle selection of YouTube videos
  const toggleYoutubeVideoSelection = (videoId: string) => {
    setSelectedYoutubeVideos(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(videoId)) {
        newSelection.delete(videoId);
      } else {
        newSelection.add(videoId);
      }
      return newSelection;
    });
  };
  
  // Toggle all YouTube videos selection
  const toggleAllYoutubeVideos = () => {
    if (selectedYoutubeVideos.size === youtubeSearchResults.length && youtubeSearchResults.length > 0) {
      setSelectedYoutubeVideos(new Set());
    } else {
      setSelectedYoutubeVideos(new Set(youtubeSearchResults.map(video => video.id)));
    }
  };
  
  // Import selected YouTube videos
  const importSelectedVideos = async () => {
    if (selectedYoutubeVideos.size === 0) return;
    
    try {
      setImportingVideos(true);
      setImportResults(null);
      // Show the processing dialog immediately
      setShowProcessingDialog(true);
      
      const response = await fetch("/api/vector/bulk-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: Array.from(selectedYoutubeVideos),
          userId: "00000000-0000-0000-0000-000000000000", // Default user ID
          chunkingMethod: chunkingMethod,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to import videos");
      }
      
      const results = await response.json();
      
      // Hide processing dialog and show results
      setShowProcessingDialog(false);
      setImportResults(results);
      setShowImportResults(true);
      
      // Clear selection
      setSelectedYoutubeVideos(new Set());
      
      // Notify parent component to refresh the video list
      onImportComplete(results);
      
      // Show a toast notification
      toast({
        title: "Bulk Import Complete",
        description: `Processed ${results.totalVideos} videos: ${results.successCount} imported, ${results.alreadyExistsCount} already existed, ${results.errorCount} failed`,
      });
    } catch (error) {
      console.error("Error importing videos:", error);
      
      // Hide processing dialog on error
      setShowProcessingDialog(false);
      
      toast({
        title: "Import Failed",
        description: error instanceof Error ? error.message : "Failed to import videos",
        variant: "destructive",
      });
    } finally {
      setImportingVideos(false);
    }
  };
  
  return (
    <Card className="p-6 bg-gray-900 border-gray-800 text-white">
      <CardHeader>
        <CardTitle>Search YouTube</CardTitle>
        <CardDescription>
          Search for videos on YouTube, select multiple videos, and bulk import them into your database
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Search Input */}
          <div className="space-y-2">
            <Label htmlFor="youtube-search">Search Term</Label>
            <div className="flex gap-2">
              <Input
                id="youtube-search"
                placeholder="Search YouTube videos..."
                value={youtubeSearchTerm}
                onChange={(e) => setYoutubeSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchYoutube()}
                className="flex-1 bg-gray-800 border-gray-700 text-white"
              />
              <Button 
                onClick={searchYoutube} 
                disabled={youtubeSearching || !youtubeSearchTerm.trim()}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {youtubeSearching ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Searching
                  </>
                ) : (
                  <>
                    <Youtube className="mr-2 h-4 w-4" />
                    Search
                  </>
                )}
              </Button>
            </div>
          </div>
          
          {/* Error Message */}
          {youtubeError && (
            <div className="p-4 bg-red-900/20 border border-red-800 rounded-md text-red-300">
              <div className="flex items-start">
                <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Search Error</p>
                  <p className="text-sm">{youtubeError}</p>
                </div>
              </div>
            </div>
          )}
          
          {/* Results */}
          {youtubeSearchResults.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Search Results</h3>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="select-all-youtube"
                    checked={selectedYoutubeVideos.size === youtubeSearchResults.length && youtubeSearchResults.length > 0}
                    onCheckedChange={toggleAllYoutubeVideos}
                  />
                  <Label htmlFor="select-all-youtube" className="text-sm cursor-pointer">
                    Select All
                  </Label>
                  
                  {selectedYoutubeVideos.size > 0 && (
                    <Button 
                      onClick={importSelectedVideos}
                      disabled={importingVideos}
                      className="ml-2 bg-blue-600 hover:bg-blue-700"
                      size="sm"
                    >
                      {importingVideos ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4 mr-2" />
                          Import {selectedYoutubeVideos.size} Video{selectedYoutubeVideos.size !== 1 ? 's' : ''}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
              
              {/* Remove max-height constraint to make results take up full page */}
              <div className="space-y-3 pr-2">
                {youtubeSearchResults.map((video) => (
                  <div 
                    key={video.id} 
                    className={`p-4 rounded-md flex gap-4 hover:bg-gray-800/70 border border-gray-800 ${
                      selectedYoutubeVideos.has(video.id) ? 'bg-blue-900/20 border-blue-800' : 'bg-gray-900'
                    }`}
                  >
                    <div className="flex-shrink-0">
                      <Checkbox
                        checked={selectedYoutubeVideos.has(video.id)}
                        onCheckedChange={() => toggleYoutubeVideoSelection(video.id)}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex-shrink-0 w-40 h-24 relative">
                      <img 
                        src={video.thumbnailUrl} 
                        alt={video.title}
                        className="w-full h-full object-cover rounded-md"
                      />
                      
                      {/* Add indicator badge for videos already in database */}
                      {existingVideos[video.id] && (
                        <div className="absolute top-0 right-0 bg-green-600 text-white text-xs px-2 py-1 m-1 rounded-md flex items-center">
                          <Check className="h-3 w-3 mr-1" />
                          In Database
                        </div>
                      )}
                    </div>
                    <div className="flex-grow overflow-hidden">
                      <div className="flex items-center">
                        <h4 className="font-medium text-white truncate">{video.title}</h4>
                        
                        {/* Alternative indicator next to title */}
                        {existingVideos[video.id] && (
                          <span className="ml-2 flex items-center text-xs text-green-400 border border-green-600/30 bg-green-600/10 rounded-full px-2 py-0.5">
                            <Check className="h-3 w-3 mr-1" />
                            Imported
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        <span className="flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                          </svg>
                          {video.viewCount ? parseInt(video.viewCount).toLocaleString() : '—'} views
                        </span>
                        <span className="flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
                          </svg>
                          {video.likeCount ? parseInt(video.likeCount).toLocaleString() : '—'} likes
                        </span>
                        <span className="flex items-center">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 5v8a2 2 0 01-2 2h-5l-5 4v-4H4a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2zM7 8H5v2h2V8zm2 0h2v2H9V8zm6 0h-2v2h2V8z" clipRule="evenodd" />
                          </svg>
                          {video.commentCount ? parseInt(video.commentCount).toLocaleString() : '—'} comments
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-2 line-clamp-2">{video.description}</p>
                      <div className="flex items-center mt-2">
                        <span className="text-xs text-gray-500">{video.channelTitle}</span>
                        <span className="mx-2 text-gray-700">•</span>
                        <span className="text-xs text-gray-500">
                          {new Date(video.publishedAt).toLocaleDateString()}
                        </span>
                        <a 
                          href={`https://www.youtube.com/watch?v=${video.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-blue-500 hover:text-blue-400"
                          title="Watch on YouTube"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* No Results Message */}
          {!youtubeSearching && youtubeSearchTerm && youtubeSearchResults.length === 0 && !youtubeError && (
            <div className="p-8 text-center text-gray-400">
              <Youtube className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">No videos found matching your search.</p>
              <p className="text-sm mt-2">Try a different search term or check your API key configuration.</p>
            </div>
          )}
          
          {/* Getting Started Message */}
          {!youtubeSearchTerm && youtubeSearchResults.length === 0 && !youtubeError && (
            <div className="p-8 text-center text-gray-400">
              <Youtube className="h-16 w-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg">Search for YouTube videos to import</p>
              <p className="text-sm mt-2">Enter keywords above to find videos you want to analyze.</p>
            </div>
          )}
        </div>
      </CardContent>
      
      {/* Add the ProcessingImportDialog */}
      <ProcessingImportDialog
        isOpen={showProcessingDialog}
        onClose={() => setShowProcessingDialog(false)}
        videoCount={selectedYoutubeVideos.size}
      />
    </Card>
  );
} 