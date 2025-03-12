"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ChevronLeft, Search, X, ExternalLink } from "lucide-react";
import Link from "next/link";

interface VideoItem {
  id: string;
  title: string;
  channelTitle: string;
  viewCount: number;
  totalChunks: number;
  processed: boolean;
  processingDate: string;
  analyzed?: boolean;
  commentCount?: number;
  transcriptLength?: number;
  wordCount?: number;
}

export default function SearchPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoItem[]>([]);

  // Fetch all videos on page load
  useEffect(() => {
    fetchVideos();
  }, []);

  // Function to fetch processed videos from the database
  const fetchVideos = async () => {
    try {
      setIsLoading(true);
      
      const response = await fetch("/api/vector/videos?userId=00000000-0000-0000-0000-000000000000", {
        method: "GET",
      });
      
      if (!response.ok) {
        throw new Error("Failed to fetch videos");
      }
      
      const data = await response.json();
      setVideos(data.videos || []);
      setFilteredVideos(data.videos || []);
    } catch (error) {
      console.error("Error fetching videos:", error);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Filter videos when search term changes
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredVideos(videos);
      return;
    }
    
    const filtered = videos.filter(video => 
      video.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      video.channelTitle.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    setFilteredVideos(filtered);
  }, [searchTerm, videos]);
  
  // Clear search
  const clearSearch = () => {
    setSearchTerm("");
  };
  
  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Link href="/database">
            <Button variant="outline" size="icon" className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Video Search</h1>
        </div>
        
        {/* Search input */}
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <Search className="h-4 w-4 text-gray-500" />
          </div>
          <Input
            type="search"
            placeholder="Search video titles or channels..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10 bg-background"
            autoFocus
          />
          {searchTerm && (
            <button 
              onClick={clearSearch}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-700"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      
      {/* Results */}
      <Card className="bg-gray-900 border-gray-800 text-white">
        <CardHeader>
          <CardTitle>Search Results</CardTitle>
          <CardDescription>
            {isLoading ? 
              "Loading videos..." : 
              filteredVideos.length > 0 ? 
                `Found ${filteredVideos.length} video${filteredVideos.length === 1 ? '' : 's'}` : 
                searchTerm ? 
                  "No videos match your search" : 
                  "Enter a search term to find videos"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400">Loading videos...</p>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="py-8 text-center">
              {searchTerm ? (
                <div>
                  <p className="text-gray-400 mb-4">No videos match your search terms.</p>
                  <Button variant="outline" onClick={clearSearch}>
                    Clear Search
                  </Button>
                </div>
              ) : (
                <p className="text-gray-400">Enter a search term to find videos.</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredVideos.map(video => (
                <div key={video.id} className="border border-gray-800 rounded-lg p-4 hover:bg-gray-800/50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-lg">{video.title}</h3>
                      <p className="text-gray-400 text-sm">{video.channelTitle}</p>
                      
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                        <span>Processed: {formatDate(video.processingDate)}</span>
                        <span>•</span>
                        <span>{video.wordCount?.toLocaleString() || 0} words</span>
                        <span>•</span>
                        <span>{video.commentCount || 0} comments</span>
                      </div>
                    </div>
                    
                    <Link href={`/analysis/${video.id}`}>
                      <Button variant="outline" size="sm" className="flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        View
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 