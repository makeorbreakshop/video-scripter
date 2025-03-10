"use client"

import { useState } from "react"
import { AIChat } from "@/components/ai-chat"
import { ScriptingTools } from "@/components/phase-tools/scripting-tools"
import { ResearchTools } from "@/components/phase-tools/research-tools"
import { RefinementTools } from "@/components/phase-tools/refinement-tools"
import { ExportTools } from "@/components/phase-tools/export-tools"
import { WorkflowPhase } from "@/types/workflow"
import { MessageSquare, Wrench, FileText, Plus } from "lucide-react"

interface ToolsPanelProps {
  currentPhase: WorkflowPhase
  scriptData: any
  updateScriptData: (data: any) => void
  panelWidth: number
}

export function ToolsPanel({ currentPhase, scriptData, updateScriptData, panelWidth }: ToolsPanelProps) {
  const [activeTab, setActiveTab] = useState("tools")

  const getToolsComponent = () => {
    switch (currentPhase) {
      case WorkflowPhase.Research:
        return <ResearchTools data={scriptData.research} updateData={(data) => updateScriptData({ research: data })} />
      case WorkflowPhase.Scripting:
        return activeTab === "templates" ? (
          <ScriptingTools
            data={scriptData.scripting}
            researchData={scriptData.research}
            updateData={(data) => updateScriptData({ scripting: data })}
          />
        ) : null
      case WorkflowPhase.Refinement:
        return (
          <RefinementTools
            data={scriptData.refinement}
            scriptData={scriptData}
            updateData={(data) => updateScriptData({ refinement: data })}
          />
        )
      case WorkflowPhase.Export:
        return (
          <ExportTools
            data={scriptData.export}
            scriptData={scriptData}
            updateData={(data) => updateScriptData({ export: data })}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Panel header */}
      <div className="tools-panel-header">
        <h2 className="text-sm font-medium">Assistant</h2>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-border">
        <div className="flex px-2 pt-2">
          <button
            className={`px-3 py-1.5 text-sm rounded-t-md ${activeTab === "tools" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("tools")}
          >
            <Wrench className="h-4 w-4 inline mr-2" />
            Tools
          </button>

          <button
            className={`px-3 py-1.5 text-sm rounded-t-md ${activeTab === "ai" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
            onClick={() => setActiveTab("ai")}
          >
            <MessageSquare className="h-4 w-4 inline mr-2" />
            AI Chat
          </button>

          {currentPhase === WorkflowPhase.Scripting && (
            <button
              className={`px-3 py-1.5 text-sm rounded-t-md ${activeTab === "templates" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
              onClick={() => setActiveTab("templates")}
            >
              <FileText className="h-4 w-4 inline mr-2" />
              Templates
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "ai" ? (
          <AIChat />
        ) : activeTab === "tools" ? (
          <div className="p-4">{getToolsComponent()}</div>
        ) : (
          <div className="p-4">{getToolsComponent()}</div>
        )}
      </div>

      {/* Add button (Craft-style) */}
      <div className="p-4 border-t border-border">
        <button className="w-full py-2 px-3 rounded-md bg-secondary hover:bg-secondary/80 transition-colors text-sm flex items-center justify-center">
          <Plus className="h-4 w-4 mr-2" />
          Add Block
        </button>
      </div>
    </div>
  )
}

