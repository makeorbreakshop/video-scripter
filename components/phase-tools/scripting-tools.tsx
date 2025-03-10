"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ScriptingData } from "@/types/workflow"
import { FileText, Star, ArrowRight, Check } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

interface ScriptingToolsProps {
  data?: ScriptingData
  researchData?: any
  updateData?: (data: ScriptingData) => void
  createDocument?: (type: DocumentType, title?: string) => any
}

export function ScriptingTools({
  data = {
    introBrick: { hook: "", problem: "", setup: "", credibility: "", transition: "" },
    middleBricks: [],
    endBrick: { transition: "", callToAction: "" },
  },
  researchData = {},
  updateData = () => {},
  createDocument = () => {},
}: ScriptingToolsProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("templates")
  const { toast } = useToast()

  const templates = [
    {
      id: "problem-solution",
      name: "Problem-Solution",
      description: "Present a problem and walk through your solution",
      icon: FileText,
      content: `# Introduction

## Hook
[Start with a compelling hook that grabs attention]

## Problem Statement
[Clearly state the problem your viewers are facing]

## Setup
[Explain what you'll cover in this video]

# Main Content

## Point 1: Understanding the Problem
[Explain why this problem exists and why it matters]

## Point 2: Solution Overview
[Introduce your solution approach]

## Point 3: Step-by-Step Implementation
[Break down the solution into actionable steps]

## Point 4: Common Pitfalls
[Discuss mistakes to avoid]

# Conclusion

## Summary
[Recap the key points from your video]

## Call to Action
[Tell viewers what to do next - subscribe, comment, etc.]`,
    },
    {
      id: "tutorial",
      name: "Step-by-Step Tutorial",
      description: "Teach a process with clear, sequential steps",
      icon: FileText,
      content: `# Introduction

## Hook
[Start with the end result to grab attention]

## Problem/Need
[Explain what skill/knowledge viewers will gain]

## Credibility
[Briefly establish why you're qualified to teach this]

# Main Content

## Point 1: Overview
[Provide a high-level explanation of the process]

## Point 2: Step One
[Detailed explanation of the first step]

## Point 3: Step Two
[Detailed explanation of the second step]

## Point 4: Step Three
[Detailed explanation of the third step]

## Point 5: Common Issues
[Address potential problems viewers might encounter]

# Conclusion

## Recap
[Summarize what viewers have learned]

## Call to Action
[Encourage viewers to try it themselves and share results]`,
    },
    {
      id: "review",
      name: "Product Review",
      description: "Evaluate a product with pros, cons, and verdict",
      icon: FileText,
      content: `# Introduction

## Hook
[Start with your verdict/rating to grab attention]

## Setup
[Explain what you're reviewing and why it matters]

## Disclosure
[Mention if this is sponsored or how you obtained the product]

# Main Content

## Point 1: Overview
[Introduce the product/service and its intended purpose]

## Point 2: Key Features
[Discuss the main features and what they offer]

## Point 3: Pros
[Highlight the positive aspects]

## Point 4: Cons
[Discuss the drawbacks or limitations]

## Point 5: Use Cases
[Explain who would benefit most from this]

# Conclusion

## Final Verdict
[Summarize your overall assessment]

## Recommendations
[Suggest alternatives if relevant]

## Call to Action
[Ask viewers to share their experiences or questions]`,
    },
    {
      id: "empty",
      name: "Blank Template",
      description: "Start with a minimal structure",
      icon: FileText,
      content: `# Introduction

[Your introduction here]

# Main Content

[Your main content here]

# Conclusion

[Your conclusion here]`,
    },
  ]

  const snippets = [
    {
      id: "hook-formula",
      name: "Hook Formula",
      content: `Did you know that [surprising statistic]? In this video, I'll show you how to [solve problem] without [common pain point]. By the end, you'll know exactly how to [achieve desired outcome].`,
    },
    {
      id: "call-to-action",
      name: "Call to Action",
      content: `If you found this helpful, make sure to hit that like button and subscribe for more videos like this one. Drop a comment below with your biggest takeaway or any questions you have. And don't forget to check out the link in the description for [additional resource].`,
    },
    {
      id: "transition",
      name: "Smooth Transition",
      content: `Now that we've covered [previous point], let's move on to something equally important: [next point]. This builds on what we just discussed and will help you [benefit].`,
    },
  ]

  const importTemplate = () => {
    if (!selectedTemplate) {
      toast({
        description: "Please select a template first",
      })
      return
    }

    const template = templates.find((t) => t.id === selectedTemplate)
    if (!template) return

    // Create a new document with the template content
    const newDoc = createDocument("script", `${template.name} Script`)

    // Format the template content as HTML for the document
    if (newDoc) {
      const formattedContent = template.content
        .replace(/# (.*)/g, "<h1>$1</h1>")
        .replace(/## (.*)/g, "<h2>$1</h2>")
        .replace(/\[([^\]]+)\]/g, "<em>$1</em>")
        .split("\n\n")
        .join("</p><p>")

      newDoc.content = `<p>${formattedContent}</p>`

      toast({
        title: "Template Imported",
        description: `${template.name} template has been imported as a new document`,
      })
    }
  }

  const importSnippet = (snippetId: string) => {
    const snippet = snippets.find((s) => s.id === snippetId)
    if (!snippet) return

    // Copy to clipboard
    navigator.clipboard.writeText(snippet.content)

    toast({
      title: "Snippet Copied",
      description: `${snippet.name} has been copied to clipboard`,
    })
  }

  const formatTemplateContent = (content: string) => {
    return content.split("\n").map((line, index) => {
      if (line.startsWith("# ")) {
        return (
          <h3 key={index} className="text-base font-bold mt-3 mb-1">
            {line.substring(2)}
          </h3>
        )
      } else if (line.startsWith("## ")) {
        return (
          <h4 key={index} className="text-sm font-semibold mt-2 mb-1">
            {line.substring(3)}
          </h4>
        )
      } else if (line.trim() === "") {
        return <div key={index} className="h-2"></div>
      } else {
        return (
          <p key={index} className="text-xs mb-1">
            {line}
          </p>
        )
      }
    })
  }

  return (
    <div className="p-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="snippets">Snippets</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          <div className="grid grid-cols-1 gap-2">
            {templates.map((template) => (
              <Button
                key={template.id}
                variant={selectedTemplate === template.id ? "default" : "outline"}
                size="sm"
                className="w-full justify-start"
                onClick={() => setSelectedTemplate(template.id)}
              >
                <template.icon className="h-4 w-4 mr-2" />
                {template.name}
              </Button>
            ))}
          </div>

          {selectedTemplate && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex justify-between items-center">
                  <span>{templates.find((t) => t.id === selectedTemplate)?.name} Preview</span>
                  <Button size="sm" onClick={importTemplate} className="h-8">
                    <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                    Import
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="max-h-[400px] overflow-y-auto bg-muted/50 rounded p-3">
                {formatTemplateContent(templates.find((t) => t.id === selectedTemplate)?.content || "")}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="snippets" className="space-y-4">
          {snippets.map((snippet) => (
            <Card key={snippet.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex justify-between items-center">
                  <div className="flex items-center">
                    <Star className="h-4 w-4 mr-2 text-yellow-500" />
                    {snippet.name}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => importSnippet(snippet.id)} className="h-7">
                    <Check className="h-3.5 w-3.5 mr-1.5" />
                    Copy
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="bg-muted/50 rounded p-3 text-sm">{snippet.content}</CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}

