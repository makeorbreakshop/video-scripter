"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { extractYouTubeId } from "@/lib/utils"
import type { ResearchData, ResearchAnalysis } from "@/types/workflow"
import { Plus, Trash2, Youtube, AlignJustify, MessageSquare, Lightbulb } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface ResearchEditorProps {
  data: ResearchData
  updateData: (data: ResearchData) => void
}

export function ResearchEditor({ data, updateData }: ResearchEditorProps) {
  const [newUrl, setNewUrl] = useState("")
  const [activeTab, setActiveTab] = useState("videos")
  const [isProcessing, setIsProcessing] = useState(false)

  const addVideoUrl = () => {
    if (!newUrl) return

    const videoId = extractYouTubeId(newUrl)
    if (!videoId) {
      alert("Invalid YouTube URL")
      return
    }

    if (data.videoUrls.includes(newUrl)) {
      alert("This video has already been added")
      return
    }

    updateData({
      ...data,
      videoUrls: [...data.videoUrls, newUrl],
    })

    setNewUrl("")
  }

  const removeVideoUrl = (url: string) => {
    updateData({
      ...data,
      videoUrls: data.videoUrls.filter((u) => u !== url),
    })
  }

  const updateNotes = (notes: string) => {
    updateData({
      ...data,
      notes,
    })
  }

  const updateSummary = (summary: string) => {
    updateData({
      ...data,
      summary,
    })
  }

  const processAllVideos = () => {
    setIsProcessing(true)

    // Simulate API call with timeout
    setTimeout(() => {
      // First, simulate fetching metadata, transcripts and comments
      const analyzedVideos = data.videoUrls.map((url) => {
        const videoId = extractYouTubeId(url) || "unknown"
        return {
          id: videoId,
          title: `How to Create Engaging YouTube Content (${videoId.substring(0, 4)})`,
          channelName: "Content Creator Academy",
          viewCount: Math.floor(Math.random() * 1000000) + 50000,
          likeCount: Math.floor(Math.random() * 50000) + 2000,
          publishDate: "2023-01-01",
          transcript: "This is a sample transcript. In a real app, this would be the actual video transcript.",
          topComments: [
            "This tutorial completely changed my workflow!",
            "I've been looking for a simple explanation like this for ages.",
            "Could you make a follow-up on optimizing videos for the algorithm?",
            "What software do you use for your thumbnails?",
            "I implemented these tips and saw a 30% increase in retention.",
          ],
          hasProcessedData: true,
        }
      })

      // Now simulate AI analysis of all the collected data
      const analysis: ResearchAnalysis = {
        contentCoverage: [
          "Scripting techniques for better audience retention",
          "Thumbnail design principles that increase CTR",
          "Hook strategies that grab viewer attention in the first 15 seconds",
          "Analytics interpretation for content optimization",
          "Storytelling frameworks for more engaging content",
        ],
        audienceReactions: [
          "Strong positive response to step-by-step tutorials",
          "Appreciation for clear, concise explanations without fluff",
          "High engagement with before/after demonstration segments",
          "Requests for downloadable templates and resources",
          "Enthusiasm about real-world examples and case studies",
        ],
        commonQuestions: [
          "What tools and software are recommended for beginners?",
          "How to balance quality vs. quantity in publishing schedule?",
          "Effective ways to research trending topics in specific niches?",
          "How to optimize videos for the YouTube algorithm?",
          "Strategies for growing a channel from zero subscribers?",
        ],
        contentSuggestions: [
          "Create a comprehensive guide to YouTube's algorithm in 2023",
          "Develop a series on creating content that appeals to both beginners and experts",
          "Provide actionable tips for batch producing videos to save time",
          "Compare different scripting methods with real performance data",
          "Share a behind-the-scenes look at your content creation process",
        ],
        isProcessed: true,
        lastProcessed: new Date().toISOString(),
      }

      updateData({
        ...data,
        analyzedVideos,
        analysis,
      })

      setIsProcessing(false)
      setActiveTab("analysis")
    }, 3000)
  }

  const hasVideos = data.videoUrls.length > 0
  const hasAnalysis = data.analysis?.isProcessed

  return (
    <div className="editor-container">
      <h1 className="editor-title">Research</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="videos">Video Collection</TabsTrigger>
          <TabsTrigger value="analysis" disabled={!hasAnalysis}>
            Analysis
          </TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="space-y-4">
          <Card className="border border-border bg-card">
            <CardHeader className="border-b border-border">
              <h2 className="text-lg font-medium">Video Analysis</h2>
              <p className="text-sm text-muted-foreground">
                Add YouTube videos to analyze their content, transcripts, and audience response.
              </p>
            </CardHeader>
            <CardContent className="p-4">
              <div className="flex gap-2 mb-4">
                <Input
                  className="flex-1"
                  placeholder="Paste YouTube URL"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
                <Button onClick={addVideoUrl}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
              </div>

              {hasVideos ? (
                <div className="space-y-2">
                  {data.videoUrls.map((url, index) => {
                    const videoId = extractYouTubeId(url)
                    return (
                      <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-md">
                        {videoId && (
                          <div className="flex items-center flex-1 overflow-hidden">
                            <div className="h-10 w-16 bg-secondary rounded-md mr-3 overflow-hidden flex-shrink-0">
                              <img
                                src={`https://img.youtube.com/vi/${videoId}/default.jpg`}
                                alt="Thumbnail"
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <span className="truncate text-sm">{url}</span>
                          </div>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 p-0 ml-2"
                          onClick={() => removeVideoUrl(url)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 border border-dashed border-border rounded-md">
                  <Youtube className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground text-center">
                    Add YouTube videos to analyze their content, structure, and audience response.
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t border-border p-4">
              <Button className="w-full" disabled={!hasVideos || isProcessing} onClick={processAllVideos}>
                {isProcessing ? "Processing Videos..." : "Process All Videos"}
              </Button>
            </CardFooter>
          </Card>

          {hasAnalysis && (
            <div className="bg-secondary p-3 rounded-md">
              <p className="text-sm flex items-center">
                <AlignJustify className="h-4 w-4 mr-2 text-primary" />
                <span>Analysis has been generated. View it in the Analysis tab.</span>
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          {hasAnalysis && data.analysis ? (
            <>
              <Card>
                <CardHeader className="border-b border-border">
                  <div className="flex justify-between items-center">
                    <h2 className="text-lg font-medium">AI Analysis Report</h2>
                    <Badge variant="outline">{new Date(data.analysis.lastProcessed!).toLocaleDateString()}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Based on {data.videoUrls.length} analyzed videos and their audience response
                  </p>
                </CardHeader>
                <CardContent className="p-4 space-y-6">
                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center">
                      <AlignJustify className="h-4 w-4 mr-2 text-primary" />
                      Content Coverage
                    </h3>
                    <ul className="space-y-1 pl-6 list-disc text-sm">
                      {data.analysis.contentCoverage.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center">
                      <MessageSquare className="h-4 w-4 mr-2 text-primary" />
                      Audience Reactions
                    </h3>
                    <ul className="space-y-1 pl-6 list-disc text-sm">
                      {data.analysis.audienceReactions.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center">
                      <MessageSquare className="h-4 w-4 mr-2 text-primary" />
                      Common Questions
                    </h3>
                    <ul className="space-y-1 pl-6 list-disc text-sm">
                      {data.analysis.commonQuestions.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium mb-2 flex items-center">
                      <Lightbulb className="h-4 w-4 mr-2 text-primary" />
                      Content Suggestions
                    </h3>
                    <ul className="space-y-1 pl-6 list-disc text-sm">
                      {data.analysis.contentSuggestions.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-border rounded-md">
              <AlignJustify className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground text-center">
                No analysis data available. Add YouTube videos and click "Process All Videos" to generate an analysis.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes" className="space-y-4">
          <Card>
            <CardHeader className="border-b border-border">
              <h2 className="text-lg font-medium">Personal Notes</h2>
              <p className="text-sm text-muted-foreground">
                Record your observations and ideas about the videos you've analyzed.
              </p>
            </CardHeader>
            <CardContent className="p-4">
              <Textarea
                className="min-h-[150px] bg-muted"
                placeholder="Add your observations and ideas here..."
                value={data.notes}
                onChange={(e) => updateNotes(e.target.value)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border">
              <h2 className="text-lg font-medium">Research Summary</h2>
              <p className="text-sm text-muted-foreground">
                Summarize your research findings to guide your script creation.
              </p>
            </CardHeader>
            <CardContent className="p-4">
              <Textarea
                className="min-h-[150px] bg-muted"
                placeholder="Summarize your research findings here..."
                value={data.summary}
                onChange={(e) => updateSummary(e.target.value)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

