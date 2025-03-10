"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { RefinementData } from "@/types/workflow"
import { Play, Pause } from "lucide-react"

interface RefinementEditorProps {
  data: RefinementData
  scriptData: any
  updateData: (data: RefinementData) => void
}

export function RefinementEditor({ data, scriptData, updateData }: RefinementEditorProps) {
  const [activeTab, setActiveTab] = useState("review")
  const [isPlaying, setIsPlaying] = useState(false)
  const [localChecklist, setLocalChecklist] = useState<Record<string, boolean>>(data.checklist || {})

  // Initialize checklist if empty using useEffect instead of during render
  useEffect(() => {
    const defaultChecklist = {
      "title-thumbnail": false,
      "language-simplicity": false,
      "sentence-length": false,
      transitions: false,
      "beginner-friendly": false,
      repetition: false,
    }

    // Only initialize if checklist is empty
    if (Object.keys(data.checklist).length === 0) {
      updateData({
        ...data,
        checklist: defaultChecklist,
      })
      setLocalChecklist(defaultChecklist)
    }
  }, [data, updateData])

  const toggleChecklistItem = (key: string) => {
    const updatedChecklist = {
      ...localChecklist,
      [key]: !localChecklist[key],
    }

    setLocalChecklist(updatedChecklist)

    updateData({
      ...data,
      checklist: updatedChecklist,
    })
  }

  const getFullScript = () => {
    const introParts = [
      scriptData.scripting.introBrick.hook,
      scriptData.scripting.introBrick.problem,
      scriptData.scripting.introBrick.setup,
      scriptData.scripting.introBrick.credibility,
      scriptData.scripting.introBrick.transition,
    ]
      .filter(Boolean)
      .join("\n\n")

    const middleParts = scriptData.scripting.middleBricks
      .map((brick: any) => {
        return [brick.transition, brick.example, brick.application, brick.nextTransition].filter(Boolean).join("\n\n")
      })
      .join("\n\n")

    const endParts = [scriptData.scripting.endBrick.transition, scriptData.scripting.endBrick.callToAction]
      .filter(Boolean)
      .join("\n\n")

    return [introParts, middleParts, endParts].filter(Boolean).join("\n\n")
  }

  const toggleReadAloud = () => {
    setIsPlaying(!isPlaying)

    // This is a placeholder for text-to-speech functionality
    // In a real implementation, you would use the Web Speech API or a similar service
    if (!isPlaying) {
      alert("In a full implementation, this would start reading the script aloud.")
    } else {
      alert("In a full implementation, this would stop reading the script aloud.")
    }
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <h1 className="text-2xl font-bold mb-6">Refinement</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="review">Script Review</TabsTrigger>
          <TabsTrigger value="analysis">Content Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="review">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Read Aloud</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground">
                    Reading your script aloud helps catch awkward phrasing and flow issues.
                  </p>
                  <Button onClick={toggleReadAloud}>
                    {isPlaying ? (
                      <>
                        <Pause className="h-4 w-4 mr-2" />
                        Pause
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Read Aloud
                      </>
                    )}
                  </Button>
                </div>

                <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded max-h-[300px] overflow-auto">
                  <pre className="whitespace-pre-wrap">{getFullScript()}</pre>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Refinement Checklist</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="title-thumbnail"
                      checked={localChecklist["title-thumbnail"] || false}
                      onCheckedChange={() => toggleChecklistItem("title-thumbnail")}
                    />
                    <label
                      htmlFor="title-thumbnail"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Title and thumbnail alignment
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="language-simplicity"
                      checked={localChecklist["language-simplicity"] || false}
                      onCheckedChange={() => toggleChecklistItem("language-simplicity")}
                    />
                    <label
                      htmlFor="language-simplicity"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Language simplicity check
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="sentence-length"
                      checked={localChecklist["sentence-length"] || false}
                      onCheckedChange={() => toggleChecklistItem("sentence-length")}
                    />
                    <label
                      htmlFor="sentence-length"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Sentence length and clarity
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="transitions"
                      checked={localChecklist["transitions"] || false}
                      onCheckedChange={() => toggleChecklistItem("transitions")}
                    />
                    <label
                      htmlFor="transitions"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Transition strength
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="beginner-friendly"
                      checked={localChecklist["beginner-friendly"] || false}
                      onCheckedChange={() => toggleChecklistItem("beginner-friendly")}
                    />
                    <label
                      htmlFor="beginner-friendly"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Beginner-friendliness
                    </label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="repetition"
                      checked={localChecklist["repetition"] || false}
                      onCheckedChange={() => toggleChecklistItem("repetition")}
                    />
                    <label
                      htmlFor="repetition"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Repetition elimination
                    </label>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analysis">
          <Card>
            <CardHeader>
              <CardTitle>Script Structure</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 bg-blue-100 dark:bg-blue-900 rounded">
                  <h3 className="font-medium mb-2">Intro Brick</h3>
                  <div className="text-sm">
                    {scriptData.scripting.introBrick.hook ? "✓" : "○"} Hook
                    <br />
                    {scriptData.scripting.introBrick.problem ? "✓" : "○"} Problem/Result
                    <br />
                    {scriptData.scripting.introBrick.setup ? "✓" : "○"} Setup
                    <br />
                    {scriptData.scripting.introBrick.credibility ? "✓" : "○"} Credibility
                    <br />
                    {scriptData.scripting.introBrick.transition ? "✓" : "○"} Transition
                  </div>
                </div>

                {scriptData.scripting.middleBricks.map((brick: any, index: number) => (
                  <div key={brick.id} className="p-4 bg-green-100 dark:bg-green-900 rounded">
                    <h3 className="font-medium mb-2">Point {index + 1}</h3>
                    <div className="text-sm">
                      {brick.transition ? "✓" : "○"} Transition In
                      <br />
                      {brick.example ? "✓" : "○"} Example Brick
                      <br />
                      {brick.application ? "✓" : "○"} Application Brick
                      <br />
                      {brick.nextTransition ? "✓" : "○"} Transition Out
                    </div>
                  </div>
                ))}

                <div className="p-4 bg-purple-100 dark:bg-purple-900 rounded">
                  <h3 className="font-medium mb-2">End Brick</h3>
                  <div className="text-sm">
                    {scriptData.scripting.endBrick.transition ? "✓" : "○"} Transition to End
                    <br />
                    {scriptData.scripting.endBrick.callToAction ? "✓" : "○"} Call to Action
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

