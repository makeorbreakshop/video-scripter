"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Download, Copy } from "lucide-react"

interface ExportToolsProps {
  data?: any
  scriptData?: any
  updateData?: (data: any) => void
}

export function ExportTools({ data = {}, scriptData = {}, updateData = () => {} }: ExportToolsProps) {
  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Export Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button className="w-full">
            <Copy className="h-4 w-4 mr-2" />
            Copy to Clipboard
          </Button>
          <Button className="w-full">
            <Download className="h-4 w-4 mr-2" />
            Download as File
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Format Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium">Plain Text:</span> Simple format for easy editing
            </div>
            <div>
              <span className="font-medium">Formatted:</span> Includes section headers
            </div>
            <div>
              <span className="font-medium">Teleprompter:</span> Optimized for reading
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

