"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PackagingData } from "@/types/workflow"
import { Plus, Trash2, Type, Image, Sparkles, Lightbulb } from "lucide-react"

interface PackagingEditorProps {
  data: PackagingData
  updateData: (data: PackagingData) => void
}

export function PackagingEditor({ data, updateData }: PackagingEditorProps) {
  const [newTitle, setNewTitle] = useState("")
  const [newIdea, setNewIdea] = useState("")
  const [newThumbnailStrategy, setNewThumbnailStrategy] = useState("")
  const [newThumbnailVariation, setNewThumbnailVariation] = useState("")
  const [selectedConceptIndex, setSelectedConceptIndex] = useState(0)
  const [isGeneratingTitles, setIsGeneratingTitles] = useState(false)
  const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false)
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false)

  // Initialize ideas array if it doesn't exist
  if (!data.ideas) {
    updateData({
      ...data,
      ideas: [],
    })
  }

  const addTitle = () => {
    if (!newTitle) return

    updateData({
      ...data,
      titles: [...data.titles, { text: newTitle }],
    })

    setNewTitle("")
  }

  const removeTitle = (index: number) => {
    updateData({
      ...data,
      titles: data.titles.filter((_, i) => i !== index),
    })
  }

  const addIdea = () => {
    if (!newIdea) return

    updateData({
      ...data,
      ideas: [...(data.ideas || []), newIdea],
    })

    setNewIdea("")
  }

  const removeIdea = (index: number) => {
    updateData({
      ...data,
      ideas: (data.ideas || []).filter((_, i) => i !== index),
    })
  }

  const addThumbnailConcept = () => {
    if (!newThumbnailStrategy) return

    updateData({
      ...data,
      thumbnailConcepts: [...data.thumbnailConcepts, { strategy: newThumbnailStrategy, variations: [] }],
    })

    setNewThumbnailStrategy("")
    setSelectedConceptIndex(data.thumbnailConcepts.length)
  }

  const addThumbnailVariation = () => {
    if (!newThumbnailVariation || data.thumbnailConcepts.length === 0) return

    const updatedConcepts = [...data.thumbnailConcepts]
    updatedConcepts[selectedConceptIndex].variations.push(newThumbnailVariation)

    updateData({
      ...data,
      thumbnailConcepts: updatedConcepts,
    })

    setNewThumbnailVariation("")
  }

  const removeThumbnailConcept = (index: number) => {
    updateData({
      ...data,
      thumbnailConcepts: data.thumbnailConcepts.filter((_, i) => i !== index),
    })

    if (selectedConceptIndex >= data.thumbnailConcepts.length - 1) {
      setSelectedConceptIndex(Math.max(0, data.thumbnailConcepts.length - 2))
    }
  }

  const removeThumbnailVariation = (conceptIndex: number, variationIndex: number) => {
    const updatedConcepts = [...data.thumbnailConcepts]
    updatedConcepts[conceptIndex].variations = updatedConcepts[conceptIndex].variations.filter(
      (_, i) => i !== variationIndex,
    )

    updateData({
      ...data,
      thumbnailConcepts: updatedConcepts,
    })
  }

  const generateTitles = () => {
    setIsGeneratingTitles(true)

    // Simulate AI title generation
    setTimeout(() => {
      const newTitles = [
        {
          text: "5 YouTube Script Techniques That Doubled My Views",
          score: { curiosity: 8, alignment: 9, clarity: 7 },
        },
        {
          text: "How to Write YouTube Scripts That Keep Viewers Watching",
          score: { curiosity: 7, alignment: 8, clarity: 9 },
        },
        {
          text: "The Brick Method: Write Better YouTube Scripts in Half the Time",
          score: { curiosity: 9, alignment: 7, clarity: 8 },
        },
        {
          text: "YouTube Scripting: The Framework Pro Creators Use",
          score: { curiosity: 8, alignment: 8, clarity: 8 },
        },
      ]

      updateData({
        ...data,
        titles: [...data.titles, ...newTitles],
      })
      setIsGeneratingTitles(false)
    }, 2000)
  }

  const generateIdeas = () => {
    setIsGeneratingIdeas(true)

    // Simulate AI idea generation
    setTimeout(() => {
      const newIdeas = [
        "How to structure a YouTube script for maximum retention",
        "The psychology behind successful YouTube intros",
        "5 ways to create powerful calls to action in your videos",
        "Script templates that work for any niche",
        "How to adapt written content into engaging video scripts",
      ]

      updateData({
        ...data,
        ideas: [...(data.ideas || []), ...newIdeas],
      })
      setIsGeneratingIdeas(false)
    }, 2000)
  }

  const generateThumbnailConcepts = () => {
    setIsGeneratingThumbnails(true)

    // Simulate AI thumbnail concept generation
    setTimeout(() => {
      const newConcepts = [
        {
          strategy: "Before/After Transformation",
          variations: [
            "Split screen showing messy script notes vs. organized script template",
            "Creator struggling with script vs. confidently recording",
            "Graph showing views before and after using the method",
          ],
        },
        {
          strategy: "Cognitive Dissonance",
          variations: [
            "YouTube script with big red X's and checkmarks highlighting mistakes",
            "Script template with unexpected elements highlighted",
            "Creator looking shocked at script results",
          ],
        },
      ]

      updateData({
        ...data,
        thumbnailConcepts: [...data.thumbnailConcepts, ...newConcepts],
      })
      setIsGeneratingThumbnails(false)
    }, 2500)
  }

  const extractYouTubeId = (url: string): string | null => {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/
    const match = url.match(regExp)
    return match && match[7].length == 11 ? match[7] : null
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-medium mb-6">Packaging</h1>

      <div className="space-y-8">
        {/* Content Ideas Section */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex justify-between items-center">
              <CardTitle>Content Ideas</CardTitle>
              <Button onClick={generateIdeas} disabled={isGeneratingIdeas} size="sm">
                <Sparkles className="h-4 w-4 mr-2" />
                {isGeneratingIdeas ? "Generating..." : "Generate Ideas"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Add a content idea..."
                value={newIdea}
                onChange={(e) => setNewIdea(e.target.value)}
                className="flex-1"
              />
              <Button onClick={addIdea}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            {(data.ideas || []).length > 0 ? (
              <div className="space-y-2">
                {(data.ideas || []).map((idea, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-md group">
                    <div className="flex items-center">
                      <Lightbulb className="h-4 w-4 mr-2 text-primary" />
                      <span className="text-sm">{idea}</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 p-0" onClick={() => removeIdea(index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-md">
                <Lightbulb className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground text-center">Add content ideas or generate them with AI</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Title Development Section */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex justify-between items-center">
              <CardTitle>Title Development</CardTitle>
              <Button onClick={generateTitles} disabled={isGeneratingTitles} size="sm">
                <Sparkles className="h-4 w-4 mr-2" />
                {isGeneratingTitles ? "Generating..." : "Generate Titles"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter a title idea"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                maxLength={60}
                className="flex-1"
              />
              <Button onClick={addTitle}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            {newTitle && (
              <div className="text-sm flex items-center">
                <span className={`font-medium ${newTitle.length > 50 ? "text-warning" : "text-primary"}`}>
                  {newTitle.length}/60
                </span>
                <div className="ml-2 flex-1 bg-secondary rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${newTitle.length > 50 ? "bg-warning" : "bg-primary"}`}
                    style={{ width: `${Math.min(100, (newTitle.length / 60) * 100)}%` }}
                  ></div>
                </div>
                <span className="ml-2 text-xs text-muted-foreground">
                  {newTitle.length > 50 ? "Getting long" : "Good length"}
                </span>
              </div>
            )}

            {data.titles.length > 0 ? (
              <div className="space-y-2">
                {data.titles.map((title, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-md group">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <Type className="h-4 w-4 mr-2 text-primary" />
                        <p className="text-sm">{title.text}</p>
                      </div>
                      <div className="flex items-center mt-1">
                        <span className="text-xs text-muted-foreground mr-2">{title.text.length}/60 characters</span>
                        {title.score && (
                          <>
                            <span className="text-xs text-muted-foreground mr-2">
                              Curiosity: {title.score.curiosity}/10
                            </span>
                            <span className="text-xs text-muted-foreground">Clarity: {title.score.clarity}/10</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 p-0 ml-2" onClick={() => removeTitle(index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-md">
                <Type className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground text-center">
                  Add title ideas based on the BENS framework (Big, Easy, New, Safe).
                </p>
              </div>
            )}

            <div className="bg-muted p-4 rounded-md">
              <h3 className="text-sm font-medium mb-2">BENS Framework</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-medium">B - Big:</span> Promise a significant result or impact
                </div>
                <div>
                  <span className="font-medium">E - Easy:</span> Suggest the process is simple or accessible
                </div>
                <div>
                  <span className="font-medium">N - New:</span> Highlight novelty or a fresh approach
                </div>
                <div>
                  <span className="font-medium">S - Safe:</span> Reduce perceived risk of trying the method
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Thumbnail Concepts Section */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex justify-between items-center">
              <CardTitle>Thumbnail Concepts</CardTitle>
              <Button onClick={generateThumbnailConcepts} disabled={isGeneratingThumbnails} size="sm">
                <Sparkles className="h-4 w-4 mr-2" />
                {isGeneratingThumbnails ? "Generating..." : "Generate Concepts"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Thumbnail strategy (e.g., Before/After)"
                value={newThumbnailStrategy}
                onChange={(e) => setNewThumbnailStrategy(e.target.value)}
                className="flex-1"
              />
              <Button onClick={addThumbnailConcept}>
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
            </div>

            {data.thumbnailConcepts.length > 0 ? (
              <div className="space-y-4">
                {data.thumbnailConcepts.map((concept, conceptIndex) => (
                  <div key={conceptIndex} className="border rounded-md overflow-hidden">
                    <div className="flex items-center justify-between bg-muted p-3">
                      <div className="flex items-center">
                        <Image className="h-4 w-4 mr-2 text-primary" />
                        <h3 className="font-medium text-sm">{concept.strategy}</h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 p-0"
                        onClick={() => removeThumbnailConcept(conceptIndex)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    <div className="p-3 space-y-3">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Variation description"
                          value={conceptIndex === selectedConceptIndex ? newThumbnailVariation : ""}
                          onChange={(e) => setNewThumbnailVariation(e.target.value)}
                          className="flex-1"
                          onFocus={() => setSelectedConceptIndex(conceptIndex)}
                        />
                        <Button onClick={addThumbnailVariation} disabled={conceptIndex !== selectedConceptIndex}>
                          <Plus className="h-4 w-4 mr-2" />
                          Add
                        </Button>
                      </div>

                      {concept.variations.length > 0 ? (
                        <div className="space-y-2">
                          {concept.variations.map((variation, variationIndex) => (
                            <div
                              key={variationIndex}
                              className="flex items-center justify-between p-2 bg-secondary/50 rounded-md"
                            >
                              <span className="text-xs">{variation}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 p-0"
                                onClick={() => removeThumbnailVariation(conceptIndex, variationIndex)}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No variations added yet</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-md">
                <Image className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground text-center">
                  Add thumbnail concepts using strategies like cognitive dissonance, before/after transformation, or
                  result-oriented designs.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Videos section */}
        {data.videoUrls && data.videoUrls.length > 0 && (
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Video Collection</CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.videoUrls.map((url, index) => {
                  const videoId = extractYouTubeId(url) || ""
                  return (
                    <div key={index} className="flex flex-col bg-muted rounded-md overflow-hidden">
                      <div className="relative pb-[56.25%] w-full">
                        <img
                          src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`}
                          alt={`Video thumbnail ${index + 1}`}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-3">
                        <h3 className="text-sm font-medium truncate">Video {index + 1}</h3>
                        <p className="text-xs text-muted-foreground truncate">{url}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

