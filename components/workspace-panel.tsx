"\"use client"

import { useState } from "react"
import { type Document, type DocumentType, WorkflowPhase } from "@/types/workflow"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { DocumentLibrary } from "@/components/document-library"
import { AIChat } from "@/components/ai-chat"
import { ResearchTools } from "@/components/phase-tools/research-tools"
import { ScriptingTools } from "@/components/phase-tools/scripting-tools"
import { RefinementTools } from "@/components/phase-tools/refinement-tools"
import { ExportTools } from "@/components/phase-tools/export-tools"
import { PackagingTools } from "@/components/phase-tools/packaging-tools"
import { FileText, MessageSquare, Wrench } from "lucide-react"

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

  const getPhaseTools = () => {
    switch (currentPhase) {
      case WorkflowPhase.Research:
        return <ResearchTools />
      case WorkflowPhase.Packaging:
        return (
          <PackagingTools
            data={scriptData?.packaging || { titles: [], thumbnailConcepts: [] }}
            updateData={(data) => updateScriptData?.({ packaging: data })}
          />
        )
      case WorkflowPhase.Scripting:
        return <ScriptingTools />
      case WorkflowPhase.Refinement:
        return <RefinementTools />
      case WorkflowPhase.Export:
        return <ExportTools />
      default:
        return null
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Panel header */}
      <div className="resource-panel-header">
        <h2 className="text-sm font-medium">Resources</h2>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-border">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-12 px-2">
            <TabsTrigger value="documents" className="flex items-center">
              <FileText className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Documents</span>
            </TabsTrigger>
            <TabsTrigger value="tools" className="flex items-center">
              <Wrench className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Tools</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center">
              <MessageSquare className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">AI Chat</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="flex-1 overflow-auto p-0">
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

          <TabsContent value="tools" className="flex-1 overflow-auto p-0">
            {getPhaseTools()}
          </TabsContent>

          <TabsContent value="ai" className="flex-1 overflow-auto p-0 h-full">
            <AIChat />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

