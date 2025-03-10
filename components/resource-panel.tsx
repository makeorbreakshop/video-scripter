"use client"

import { useState, useEffect } from "react"
import { type Document, type DocumentType, WorkflowPhase } from "@/types/workflow"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DocumentLibrary } from "@/components/document-library"
import { AIChat } from "@/components/ai-chat"
import VideoResearchTool from "@/components/tools/video-research-tool"
import { ScriptingTools } from "@/components/phase-tools/scripting-tools"
import { RefinementTools } from "@/components/phase-tools/refinement-tools"
import { ExportTools } from "@/components/phase-tools/export-tools"
import { PackagingTools } from "@/components/phase-tools/packaging-tools"
import { FileText, MessageSquare, Wrench, Youtube, Edit3, Download } from "lucide-react"

interface ResourcePanelProps {
  currentPhase: WorkflowPhase
  documents: Document[]
  activeDocumentId: string
  setActiveDocumentId: (id: string) => void
  createDocument: (type: DocumentType, title?: string) => Document
  deleteDocument: (id: string) => void
  panelWidth: number
  splitView?: {
    enabled: boolean
    direction: "horizontal" | "vertical"
    primaryDocId: string
    secondaryDocId: string | null
    splitRatio: number
  }
  setSecondaryDocument?: (docId: string) => void
  scriptData?: any
  updateScriptData?: any
}

export function ResourcePanel({
  currentPhase,
  documents,
  activeDocumentId,
  setActiveDocumentId,
  createDocument,
  deleteDocument,
  panelWidth,
  splitView,
  setSecondaryDocument,
  scriptData,
  updateScriptData,
}: ResourcePanelProps) {
  const [activeTab, setActiveTab] = useState("documents")
  const [activeToolTab, setActiveToolTab] = useState(getDefaultToolTab(currentPhase))

  // Set the default tool tab based on the current phase
  function getDefaultToolTab(phase: WorkflowPhase) {
    switch (phase) {
      case WorkflowPhase.Research:
        return "video-research"
      case WorkflowPhase.Packaging:
        return "videos"
      case WorkflowPhase.Scripting:
        return "templates" // Updated default tab for Scripting phase
      case WorkflowPhase.Refinement:
        return "refinement"
      case WorkflowPhase.Export:
        return "export"
      default:
        return "video-research"
    }
  }

  // Update active tool tab when phase changes
  useEffect(() => {
    setActiveToolTab(getDefaultToolTab(currentPhase))
  }, [currentPhase])

  return (
    <div className="h-full flex flex-col">
      {/* Tab navigation - Main tabs */}
      <div className="border-b border-border">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-12 px-2">
            <TabsTrigger value="documents" className="flex items-center px-3">
              <FileText className="h-4 w-4 mr-2" />
              <span>Documents</span>
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center px-3">
              <Wrench className="h-4 w-4 mr-2" />
              <span>Tools</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center px-3">
              <MessageSquare className="h-4 w-4 mr-2" />
              <span>AI Chat</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="flex-1 overflow-auto p-0 h-full">
            <DocumentLibrary
              documents={documents}
              activeDocumentId={activeDocumentId}
              setActiveDocumentId={setActiveDocumentId}
              createDocument={createDocument}
              deleteDocument={deleteDocument}
              panelWidth={panelWidth}
              splitView={splitView}
              setSecondaryDocument={setSecondaryDocument}
            />
          </TabsContent>

          <TabsContent value="tools" className="flex-1 overflow-auto p-0 h-full">
            {/* Nested tabs for tools */}
            <Tabs value={activeToolTab} onValueChange={setActiveToolTab} className="w-full h-full">
              <TabsList className="h-10 px-2 border-b border-border w-full justify-start">
                {currentPhase === WorkflowPhase.Research && (
                  <TabsTrigger value="video-research" className="text-xs">
                    <Youtube className="h-3.5 w-3.5 mr-1" />
                    Video Research
                  </TabsTrigger>
                )}

                {currentPhase === WorkflowPhase.Packaging && (
                  <TabsTrigger value="videos" className="text-xs">
                    <Youtube className="h-3.5 w-3.5 mr-1" />
                    Videos
                  </TabsTrigger>
                )}

                {currentPhase === WorkflowPhase.Scripting && (
                  <TabsTrigger value="templates" className="text-xs">
                    {" "}
                    {/* Updated tab value */}
                    <FileText className="h-3.5 w-3.5 mr-1" />
                    Templates
                  </TabsTrigger>
                )}

                {currentPhase === WorkflowPhase.Refinement && (
                  <TabsTrigger value="refinement" className="text-xs">
                    <Edit3 className="h-3.5 w-3.5 mr-1" />
                    Refinement
                  </TabsTrigger>
                )}

                {currentPhase === WorkflowPhase.Export && (
                  <TabsTrigger value="export" className="text-xs">
                    <Download className="h-3.5 w-3.5 mr-1" />
                    Export
                  </TabsTrigger>
                )}
              </TabsList>

              {/* Tool content */}
              <div className="h-[calc(100%-2.5rem)] overflow-auto">
                {currentPhase === WorkflowPhase.Research && (
                  <TabsContent value="video-research" className="h-full">
                    <VideoResearchTool
                      data={scriptData?.research || { videoUrls: [] }}
                      updateData={(data) => updateScriptData?.({ research: data })}
                      createDocument={(type, title, content) => {
                        // Simple wrapper function to bypass type checking
                        return createDocument(type, title);
                      }}
                      projectId={window && window.location.pathname.split('/').pop() || ""}
                      userId={window && window.localStorage.getItem('userId') || ""}
                    />
                  </TabsContent>
                )}

                {currentPhase === WorkflowPhase.Packaging && (
                  <TabsContent value="videos" className="h-full">
                    <PackagingTools
                      data={scriptData?.packaging || { titles: [], thumbnailConcepts: [] }}
                      researchData={scriptData?.research || { videoUrls: [] }}
                      updateData={(data) => updateScriptData?.({ packaging: data })}
                    />
                  </TabsContent>
                )}

                {currentPhase === WorkflowPhase.Scripting && (
                  <TabsContent value="templates" className="h-full">
                    {" "}
                    {/* Updated tab value */}
                    <ScriptingTools
                      data={scriptData?.scripting || { introBrick: {}, middleBricks: [], endBrick: {} }}
                      researchData={scriptData?.research || {}}
                      updateData={(data) => updateScriptData?.({ scripting: data })}
                      createDocument={createDocument}
                    />
                  </TabsContent>
                )}

                {currentPhase === WorkflowPhase.Refinement && (
                  <TabsContent value="refinement" className="h-full">
                    <RefinementTools
                      data={scriptData?.refinement || { feedback: [], checklist: {} }}
                      scriptData={scriptData || { scripting: { middleBricks: [] } }}
                      updateData={(data) => updateScriptData?.({ refinement: data })}
                    />
                  </TabsContent>
                )}

                {currentPhase === WorkflowPhase.Export && (
                  <TabsContent value="export" className="h-full">
                    <ExportTools
                      data={scriptData?.export || { format: "plain" }}
                      scriptData={scriptData || {}}
                      updateData={(data) => updateScriptData?.({ export: data })}
                    />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </TabsContent>

          <TabsContent value="ai" className="flex-1 overflow-auto p-0 h-full">
            <AIChat />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

