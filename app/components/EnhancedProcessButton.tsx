"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, FilePlus } from "lucide-react";
import { toast } from "@/components/ui/use-toast";

interface EnhancedProcessButtonProps {
  videoUrl: string;
  userId: string;
  onSuccess?: (result: {
    videoId: string;
    totalChunks: number;
    transcriptChunks?: number;
    commentClusters?: number;
    descriptionChunks?: number;
  }) => void;
  onError?: (error: string) => void;
  className?: string;
  buttonText?: string;
}

/**
 * Button component that processes YouTube videos with enhanced chunking
 */
export function EnhancedProcessButton({
  videoUrl,
  userId,
  onSuccess,
  onError,
  className = "",
  buttonText = "Process with Enhanced Chunking"
}: EnhancedProcessButtonProps) {
  const [loading, setLoading] = useState(false);
  
  const processVideo = async () => {
    if (!videoUrl) {
      toast({
        title: "Error",
        description: "No video URL provided",
        variant: "destructive"
      });
      return;
    }
    
    setLoading(true);
    
    try {
      const response = await fetch("/api/vector/enhanced-process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          videoUrl,
          userId,
          // Default parameters (can be customized through props if needed)
          maxChunkDuration: 120,
          overlapDuration: 20,
          minChunkDuration: 30,
          commentLimit: 100,
          commentSimilarityThreshold: 0.3,
          detectPauses: true,
          respectTransitions: true
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to process video");
      }
      
      toast({
        title: "Success",
        description: `Video processed with ${result.totalChunks} chunks`,
      });
      
      if (onSuccess) {
        onSuccess(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : "Unknown error occurred";
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
      
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Button 
      className={className}
      onClick={processVideo}
      disabled={loading}
    >
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <FilePlus className="mr-2 h-4 w-4" />
          {buttonText}
        </>
      )}
    </Button>
  );
} 