"use client"

import { ResearchEditor } from "@/components/phase-editors/research-editor"
import { PackagingEditor } from "@/components/phase-editors/packaging-editor"
import { ScriptingEditor } from "@/components/phase-editors/scripting-editor"
import { RefinementEditor } from "@/components/phase-editors/refinement-editor"
import { ExportEditor } from "@/components/phase-editors/export-editor"
import { WorkflowPhase } from "@/types/workflow"

interface EditorPanelProps {
  currentPhase: WorkflowPhase
  scriptData: any
  updateScriptData: (data: any) => void
}

export function EditorPanel({ currentPhase, scriptData, updateScriptData }: EditorPanelProps) {
  return (
    <div className="flex-1 h-full overflow-auto bg-background">
      {currentPhase === WorkflowPhase.Research && (
        <ResearchEditor data={scriptData.research} updateData={(data) => updateScriptData({ research: data })} />
      )}

      {currentPhase === WorkflowPhase.Packaging && (
        <PackagingEditor
          data={scriptData.packaging || { titles: [], thumbnailConcepts: [] }}
          updateData={(data) => updateScriptData({ packaging: data })}
        />
      )}

      {currentPhase === WorkflowPhase.Scripting && (
        <ScriptingEditor data={scriptData.scripting} updateData={(data) => updateScriptData({ scripting: data })} />
      )}

      {currentPhase === WorkflowPhase.Refinement && (
        <RefinementEditor
          data={scriptData.refinement}
          scriptData={scriptData}
          updateData={(data) => updateScriptData({ refinement: data })}
        />
      )}

      {currentPhase === WorkflowPhase.Export && (
        <ExportEditor
          data={scriptData.export}
          scriptData={scriptData}
          updateData={(data) => updateScriptData({ export: data })}
        />
      )}
    </div>
  )
}

