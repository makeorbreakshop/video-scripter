"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { extractYouTubeId } from "@/lib/utils"
import { Plus, Search, FileText, AlignJustify } from "lucide-react"

export function ResearchTools() {
  const [videoUrl, setVideoUrl] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [videos, setVideos] = useState<{ id: string; title: string; thumbnail: string }[]>([])

  const addVideo = () => {
    if (!videoUrl) return

    const videoId = extractYouTubeId(videoUrl)
    if (!videoId) {
      alert("Invalid YouTube URL")
      return
    }

    // Add video to collection
    setVideos([
      ...videos,
      {
        id: videoId,
        title: `Video ${videoId}`,
        thumbnail: `https://img.youtube.com/vi/${videoId}/default.jpg`,
      },
    ])

    setVideoUrl("")
  }

  const processVideos = () => {
    setIsProcessing(true)

    // Simulate processing
    setTimeout(() => {
      setIsProcessing(false)
      // In a real app, this would update the research data
    }, 2000)
  }

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Video Collection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Paste YouTube URL"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              className="flex-1"
            />
            <Button size="sm" onClick={addVideo}>
              <Plus className="h-4 w-4 mr-2" />
              Add
            </Button>
          </div>

          {videos.length > 0 && (
            <div className="space-y-2 mb-4">
              {videos.map((video) => (
                <div key={video.id} className="flex items-center p-2 bg-muted rounded-md">
                  <div className="h-10 w-16 bg-secondary rounded-md mr-3 overflow-hidden flex-shrink-0">
                    <img
                      src={video.thumbnail || "/placeholder.svg"}
                      alt={video.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <span className="text-sm truncate">{video.title}</span>
                </div>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            variant="secondary"
            disabled={videos.length === 0 || isProcessing}
            onClick={processVideos}
          >
            <Search className="h-4 w-4 mr-2" />
            {isProcessing ? "Processing..." : "Analyze Videos"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Analysis Tools</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button variant="outline" size="sm" className="w-full justify-start">
            <FileText className="h-4 w-4 mr-2" />
            Generate Content Summary
          </Button>
          <Button variant="outline" size="sm" className="w-full justify-start">
            <AlignJustify className="h-4 w-4 mr-2" />
            Extract Key Points
          </Button>
          <Button variant="outline" size="sm" className="w-full justify-start">
            <FileText className="h-4 w-4 mr-2" />
            Create Research Document
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

