"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { RefinementData, FeedbackItem } from "@/types/workflow"
import { MessageSquare, Check } from "lucide-react"

interface RefinementToolsProps {
  data?: RefinementData
  scriptData?: any
  updateData?: (data: RefinementData) => void
}

export function RefinementTools({
  data = { feedback: [], checklist: {} },
  scriptData = { scripting: { middleBricks: [] } },
  updateData = () => {},
}: RefinementToolsProps) {
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false)
  const [selectedSection, setSelectedSection] = useState("intro")

  const generateFeedback = () => {
    setIsGeneratingFeedback(true)

    // Simulate AI feedback generation
    setTimeout(() => {
      let newFeedback: FeedbackItem

      if (selectedSection === "intro") {
        newFeedback = {
          section: "Intro",
          feedback: "Your hook is compelling, but the problem statement could be more specific to create urgency.",
          suggestion:
            "Try quantifying the problem with a statistic or specific example of what happens when scripts aren't engaging.",
        }
      } else if (selectedSection === "end") {
        newFeedback = {
          section: "End",
          feedback: "Your call to action is clear, but could benefit from a stronger emotional connection.",
          suggestion:
            "Consider adding a personal note about how these techniques have impacted you or your viewers to strengthen the connection before asking for engagement.",
        }
      } else {
        // Middle section
        const pointNumber = Number.parseInt(selectedSection.replace("point-", ""))
        newFeedback = {
          section: `Point ${pointNumber}`,
          feedback: "The example is strong, but the application steps could be more actionable.",
          suggestion:
            "Break down the application into numbered steps that viewers can easily follow and implement immediately.",
        }
      }

      updateData({
        ...data,
        feedback: [...data.feedback, newFeedback],
      })

      setIsGeneratingFeedback(false)
    }, 2000)
  }

  const getSectionOptions = () => {
    // Default options if scriptData or scriptData.scripting is undefined
    const defaultOptions = [
      { value: "intro", label: "Intro Section" },
      { value: "point-1", label: "Point 1" },
      { value: "end", label: "End Section" },
    ]

    // Check if scriptData and scriptData.scripting exist
    if (!scriptData || !scriptData.scripting) {
      return defaultOptions
    }

    // Now we can safely access scriptData.scripting
    const options = [
      { value: "intro", label: "Intro Section" },
      ...(scriptData.scripting.middleBricks || []).map((_: any, index: number) => ({
        value: `point-${index + 1}`,
        label: `Point ${index + 1}`,
      })),
      { value: "end", label: "End Section" },
    ]

    return options
  }

  return (
    <div className="p-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Feedback</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Get AI-powered feedback on specific sections of your script.
          </p>

          <div className="space-y-4">
            <select
              className="w-full p-2 border rounded bg-background"
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
            >
              {getSectionOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <Button onClick={generateFeedback} disabled={isGeneratingFeedback} className="w-full">
              <MessageSquare className="h-4 w-4 mr-2" />
              {isGeneratingFeedback ? "Generating..." : "Get Feedback"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.feedback && data.feedback.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Feedback History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {data.feedback.map((item, index) => (
                <div key={index} className="p-3 bg-slate-100 dark:bg-slate-800 rounded">
                  <h3 className="font-medium text-sm">{item.section}</h3>
                  <p className="text-xs mt-1">{item.feedback}</p>
                  <p className="text-xs mt-1 text-green-600 dark:text-green-400">
                    <span className="font-medium">Suggestion:</span> {item.suggestion}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Refinement Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center">
              <Check className="h-4 w-4 mr-2 text-green-500" />
              <span>Read your script aloud to catch awkward phrasing</span>
            </div>
            <div className="flex items-center">
              <Check className="h-4 w-4 mr-2 text-green-500" />
              <span>Check that title and content are aligned</span>
            </div>
            <div className="flex items-center">
              <Check className="h-4 w-4 mr-2 text-green-500" />
              <span>Simplify complex language and jargon</span>
            </div>
            <div className="flex items-center">
              <Check className="h-4 w-4 mr-2 text-green-500" />
              <span>Ensure transitions between points are smooth</span>
            </div>
            <div className="flex items-center">
              <Check className="h-4 w-4 mr-2 text-green-500" />
              <span>Verify all key points from research are covered</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

