"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { extractYouTubeId } from "@/lib/utils"
import { Plus, Trash2, Youtube, AlignJustify, Sparkles, Loader2 } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

interface PackagingToolsProps {
  data?: {
    titles: any[]
    thumbnailConcepts: any[]
    videoUrls?: string[]
    videoAnalysis?: {
      titleSuggestions: string[]
      thumbnailSuggestions: string[]
      contentGaps: string[]
      audienceInsights: string[]
      lastAnalyzed?: string
    }
  }
  researchData?: {
    videoUrls: string[]
  }
  updateData?: (data: any) => void
}

export function PackagingTools({
  data = { titles: [], thumbnailConcepts: [], videoUrls: [] },
  researchData = { videoUrls: [] },
  updateData = () => {},
}: PackagingToolsProps) {
  const [newVideoUrl, setNewVideoUrl] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const { toast } = useToast()

  // Initialize videoUrls if it doesn't exist
  if (!data.videoUrls) {
    updateData({
      ...data,
      videoUrls: [...researchData.videoUrls],
    })
  }

  const addVideo = () => {
    if (!newVideoUrl) return

    const videoId = extractYouTubeId(newVideoUrl)
    if (!videoId) {
      toast({
        description: "Please enter a valid YouTube URL",
      })
      return
    }

    if (data.videoUrls?.includes(newVideoUrl)) {
      toast({
        description: "This video has already been added",
      })
      return
    }

    updateData({
      ...data,
      videoUrls: [...(data.videoUrls || []), newVideoUrl],
    })
    setNewVideoUrl("")
  }

  const removeVideo = (url: string) => {
    updateData({
      ...data,
      videoUrls: (data.videoUrls || []).filter((u) => u !== url),
    })
  }

  const analyzeVideos = () => {
    if (!(data.videoUrls || []).length) {
      toast({
        description: "Please add at least one video to analyze",
      })
      return
    }

    setIsAnalyzing(true)

    // Simulate AI analysis
    setTimeout(() => {
      const videoAnalysis = {
        titleSuggestions: [
          "How I Increased My YouTube Views by 300% with This Script Formula",
          "The YouTube Script Template That Top Creators Don't Share",
          "Write Better YouTube Scripts in Half the Time: The Brick Method",
          "5 YouTube Script Mistakes Killing Your Retention (And How to Fix Them)",
        ],
        thumbnailSuggestions: [
          "Split screen showing messy notes vs. organized script template with arrow pointing to analytics graph",
          "Close-up of creator looking shocked at script with text overlay '300% MORE VIEWS'",
          "Simple template diagram with before/after retention graphs showing improvement",
          "Text-based thumbnail with 'SCRIPT TEMPLATE' and a clock showing time saved",
        ],
        contentGaps: [
          "Detailed walkthrough of script implementation for beginners",
          "Case studies showing real results from different niches",
          "Adaptation techniques for different video lengths (shorts vs. long-form)",
          "How to test and iterate on scripts based on analytics",
        ],
        audienceInsights: [
          "Viewers struggle most with creating hooks that retain attention",
          "Many are overwhelmed by the scripting process and need simplification",
          "Audience wants practical examples rather than just theory",
          "Viewers appreciate seeing the direct connection between script quality and metrics",
        ],
        lastAnalyzed: new Date().toISOString(),
      }

      updateData({
        ...data,
        videoAnalysis,
      })

      setIsAnalyzing(false)

      toast({
        title: "Analysis Complete",
        description: "Video analysis has been generated with AI insights",
      })
    }, 3000)
  }

  // Combine videos from research and any added in packaging
  const allVideos = Array.from(new Set([...(researchData.videoUrls || []), ...(data.videoUrls || [])]))

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-2">Video Collection</h2>
        <p className="text-muted-foreground">Manage videos to inform your packaging decisions</p>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">Add Videos</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Paste YouTube URL"
              value={newVideoUrl}
              onChange={(e) => setNewVideoUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={addVideo}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>

          {allVideos.length > 0 ? (
            <div className="space-y-3">
              {allVideos.map((url, index) => {
                const videoId = extractYouTubeId(url)
                return (
                  <div key={index} className="flex items-center gap-3 p-3 bg-card rounded-lg border">
                    {videoId && (
                      <img
                        src={`https://img.youtube.com/vi/${videoId}/default.jpg`}
                        alt="Thumbnail"
                        className="w-20 h-15 object-cover rounded"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{videoId ? `Video ID: ${videoId}` : url}</div>
                      <div className="text-xs text-muted-foreground truncate">{url}</div>
                    </div>
                    {data.videoUrls?.includes(url) && (
                      <Button variant="ghost" size="icon" onClick={() => removeVideo(url)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg">
              <Youtube className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground text-center">
                Add YouTube videos to analyze for packaging ideas
              </p>
            </div>
          )}

          <Button className="w-full" onClick={analyzeVideos} disabled={isAnalyzing || allVideos.length === 0}>
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing Videos...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Analyze Videos for Packaging Ideas
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {data.videoAnalysis && (
        <Card>
          <CardHeader className="border-b">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm">AI Analysis Results</CardTitle>
              <div className="text-xs text-muted-foreground">
                {data.videoAnalysis.lastAnalyzed &&
                  `Analyzed: ${new Date(data.videoAnalysis.lastAnalyzed).toLocaleDateString()}`}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center">
                <AlignJustify className="h-4 w-4 mr-2 text-primary" />
                Title Suggestions
              </h3>
              <ul className="space-y-1 pl-6 list-disc text-sm">
                {data.videoAnalysis.titleSuggestions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center">
                <Youtube className="h-4 w-4 mr-2 text-primary" />
                Thumbnail Suggestions
              </h3>
              <ul className="space-y-1 pl-6 list-disc text-sm">
                {data.videoAnalysis.thumbnailSuggestions.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center">
                <Sparkles className="h-4 w-4 mr-2 text-primary" />
                Content Gaps
              </h3>
              <ul className="space-y-1 pl-6 list-disc text-sm">
                {data.videoAnalysis.contentGaps.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-medium mb-2 flex items-center">
                <AlignJustify className="h-4 w-4 mr-2 text-primary" />
                Audience Insights
              </h3>
              <ul className="space-y-1 pl-6 list-disc text-sm">
                {data.videoAnalysis.audienceInsights.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

