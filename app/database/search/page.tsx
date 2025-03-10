"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, RefreshCw, AlertCircle, ArrowUpRight, Youtube } from "lucide-react";
import { useSearchParams } from "next/navigation";

interface SearchResult {
  id: string;
  videoId: string;
  content: string;
  contentType: string;
  startTime?: number;
  endTime?: number;
  similarity: number;
  metadata?: Record<string, any>;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState("");
  const [videoIdFilter, setVideoIdFilter] = useState<string | null>(null);
  
  const searchParams = useSearchParams();
  
  useEffect(() => {
    const videoId = searchParams.get('videoId');
    if (videoId) {
      setVideoIdFilter(videoId);
      setQuery(`content from video ${videoId}`);
    }
  }, [searchParams]);
  
  const performSearch = async () => {
    if (!query.trim()) return;
    
    try {
      setSearching(true);
      setError("");
      setResults([]);
      
      const response = await fetch("/api/vector/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          userId: "00000000-0000-0000-0000-000000000000", // Default user ID
          videoId: videoIdFilter,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }
      
      setResults(data.results || []);
    } catch (error) {
      setError(error instanceof Error ? error.message : "An unknown error occurred");
    } finally {
      setSearching(false);
    }
  };
  
  // Format time from seconds to MM:SS
  const formatTime = (seconds?: number) => {
    if (seconds == null) return "N/A";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };
  
  // Handle Enter key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !searching && query.trim()) {
      performSearch();
    }
  };
  
  // Get content type badge color
  const getContentTypeColor = (type: string) => {
    switch (type) {
      case 'transcript': return 'bg-blue-100 text-blue-800';
      case 'comment': return 'bg-green-100 text-green-800';
      case 'description': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };
  
  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <Search className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Semantic Search</h1>
      </div>
      
      <Card className="p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Search Video Content</h2>
        <p className="text-sm text-gray-600 mb-4">
          Search across all processed videos using Claude's semantic understanding. 
          Results are ordered by relevance and include timestamps for transcript content.
        </p>
        
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="Enter your search query..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={searching}
            className="flex-grow"
          />
          <Button 
            onClick={performSearch} 
            disabled={!query.trim() || searching}
          >
            {searching ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Search
          </Button>
        </div>
        
        {videoIdFilter && (
          <div className="flex items-center gap-2 mb-4 p-2 bg-blue-50 rounded-md">
            <Badge>Filtering by Video ID: {videoIdFilter}</Badge>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setVideoIdFilter(null)}
              className="h-7 px-2 text-xs"
            >
              Clear Filter
            </Button>
          </div>
        )}
        
        {error && (
          <div className="rounded-md p-4 mb-4 bg-red-50">
            <div className="flex items-start gap-2 text-red-700">
              <AlertCircle className="h-5 w-5 mt-0.5" />
              <p>{error}</p>
            </div>
          </div>
        )}
      </Card>
      
      {results.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Search Results</h2>
            <p className="text-sm text-gray-500">Found {results.length} matches</p>
          </div>
          
          <div className="space-y-4">
            {results.map((result) => (
              <Card key={result.id} className="p-4">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Badge className={`${getContentTypeColor(result.contentType)}`}>
                      {result.contentType.charAt(0).toUpperCase() + result.contentType.slice(1)}
                    </Badge>
                    <div className="text-sm text-gray-500">
                      Relevance: {Math.round(result.similarity * 100)}%
                    </div>
                  </div>
                  
                  <p className="text-sm">{result.content}</p>
                  
                  <div className="flex justify-between items-center mt-2 text-xs text-gray-500 border-t pt-2">
                    <div className="flex items-center gap-1">
                      <Youtube className="h-3.5 w-3.5" />
                      <span>Video ID: {result.videoId}</span>
                    </div>
                    
                    {result.startTime != null && (
                      <div className="flex items-center">
                        <Badge variant="outline" className="text-xs">
                          {formatTime(result.startTime)} - {formatTime(result.endTime)}
                        </Badge>
                        <a 
                          href={`https://youtube.com/watch?v=${result.videoId}&t=${Math.floor(result.startTime || 0)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-blue-600 hover:text-blue-800 flex items-center"
                        >
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
      
      {!searching && query && results.length === 0 && !error && (
        <Card className="p-6 text-center">
          <Search className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          <p className="text-gray-500 mb-2">No results found</p>
          <p className="text-sm text-gray-400">Try a different search query or process more videos</p>
        </Card>
      )}
    </div>
  );
} 