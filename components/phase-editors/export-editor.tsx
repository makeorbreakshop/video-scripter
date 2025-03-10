"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import type { ExportData } from "@/types/workflow"
import { Copy, Download, Link } from "lucide-react"

interface ExportEditorProps {
  data: ExportData
  scriptData: any
  updateData: (data: ExportData) => void
}

export function ExportEditor({ data, scriptData, updateData }: ExportEditorProps) {
  const [copied, setCopied] = useState(false)

  const updateFormat = (format: ExportData["format"]) => {
    updateData({
      ...data,
      format,
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

  const getFormattedScript = () => {
    if (data.format === "plain") {
      return getFullScript()
    } else if (data.format === "teleprompter") {
      // For teleprompter format, we add extra line breaks and make text larger
      return getFullScript().split("\n").join("\n\n")
    } else {
      // For formatted, we add section headers
      const script = []

      script.push("# INTRO")
      if (scriptData.scripting.introBrick.hook) script.push("## Hook\n" + scriptData.scripting.introBrick.hook)
      if (scriptData.scripting.introBrick.problem)
        script.push("## Problem/Result\n" + scriptData.scripting.introBrick.problem)
      if (scriptData.scripting.introBrick.setup) script.push("## Setup\n" + scriptData.scripting.introBrick.setup)
      if (scriptData.scripting.introBrick.credibility)
        script.push("## Credibility\n" + scriptData.scripting.introBrick.credibility)
      if (scriptData.scripting.introBrick.transition)
        script.push("## Transition\n" + scriptData.scripting.introBrick.transition)

      scriptData.scripting.middleBricks.forEach((brick: any, index: number) => {
        script.push(`# POINT ${index + 1}`)
        if (brick.transition) script.push("## Transition In\n" + brick.transition)
        if (brick.example) script.push("## Example\n" + brick.example)
        if (brick.application) script.push("## Application\n" + brick.application)
        if (brick.nextTransition) script.push("## Transition Out\n" + brick.nextTransition)
      })

      script.push("# END")
      if (scriptData.scripting.endBrick.transition)
        script.push("## Transition\n" + scriptData.scripting.endBrick.transition)
      if (scriptData.scripting.endBrick.callToAction)
        script.push("## Call to Action\n" + scriptData.scripting.endBrick.callToAction)

      return script.join("\n\n")
    }
  }

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getFormattedScript())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadScript = () => {
    const element = document.createElement("a")
    const file = new Blob([getFormattedScript()], { type: "text/plain" })
    element.href = URL.createObjectURL(file)
    element.download = "youtube-script.txt"
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <h1 className="text-2xl font-bold mb-6">Export</h1>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Format Options</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={data.format}
              onValueChange={(value) => updateFormat(value as ExportData["format"])}
              className="space-y-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="plain" id="plain" />
                <Label htmlFor="plain">Plain Text</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="formatted" id="formatted" />
                <Label htmlFor="formatted">Formatted Document</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="teleprompter" id="teleprompter" />
                <Label htmlFor="teleprompter">Teleprompter-Friendly</Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`p-4 bg-slate-100 dark:bg-slate-800 rounded max-h-[400px] overflow-auto ${data.format === "teleprompter" ? "text-lg" : ""}`}
            >
              <pre className="whitespace-pre-wrap">{getFormattedScript()}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export Options</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button onClick={copyToClipboard} className="flex-1">
                <Copy className="h-4 w-4 mr-2" />
                {copied ? "Copied!" : "Copy to Clipboard"}
              </Button>
              <Button onClick={downloadScript} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                Download as File
              </Button>
              <Button variant="outline" className="flex-1" disabled>
                <Link className="h-4 w-4 mr-2" />
                Generate Share Link
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

