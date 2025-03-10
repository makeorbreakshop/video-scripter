"use client"
import type { Document, DocumentType } from "@/types/workflow"
import { WorkflowPhase } from "@/types/workflow"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DocumentEditor } from "@/components/document-editor"
import { Plus } from "lucide-react"
import { X } from "lucide-react"
import { useRef } from "react"
import React from "react"

interface DocumentPanelProps {
  documents: Document[]
  activeDocumentId: string
  setActiveDocumentId: (id: string) => void
  updateDocument: (id: string, updates: Partial<Document>) => void
  createDocument: (type: DocumentType, title?: string) => Document
  deleteDocument: (id: string) => void
  currentPhase: WorkflowPhase
  isSplitView?: boolean
}

export function DocumentPanel({
  documents,
  activeDocumentId,
  setActiveDocumentId,
  updateDocument,
  createDocument,
  deleteDocument,
  currentPhase,
  isSplitView = false,
}: DocumentPanelProps) {
  const activeDocument = documents.find((doc) => doc.id === activeDocumentId) || documents[0]
  // Simple debounce for updates (basic implementation)
  const updateTimeoutRef = useRef<any>(null)

  const handleNewDocument = () => {
    createDocument("notes", "New Document")
  }

  const handleContentChange = (content: string) => {
    if (!activeDocument) return;
    
    console.log(`[Panel] Content change for document ${activeDocument.id}`);
    console.log(`[Panel] Content length: ${content.length}`);
    
    // Clear any pending updates
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
    }
    
    // Immediately update local state for responsive UI
    const updatedDocs = documents.map(doc => 
      doc.id === activeDocument.id ? {...doc, content} : doc
    );
    
    // Use a short timeout to debounce updates
    updateTimeoutRef.current = setTimeout(() => {
      console.log(`[Panel] Debounced update for document ${activeDocument.id}`);
      console.log(`[Panel] Updating content length: ${content.length}`);
      
      // Call the actual update function
      updateDocument(activeDocument.id, { content });
    }, 300);
  }

  const onTitleChange = (title: string) => {
    if (activeDocument) {
      // Immediate update for title changes
      updateDocument(activeDocument.id, { title })
    }
  }

  // Filter documents based on current phase
  const filteredDocuments = documents.filter((doc) => {
    if (currentPhase === WorkflowPhase.Research) {
      return doc.type === "notes" || doc.type === "research"
    } else if (currentPhase === WorkflowPhase.Scripting) {
      return doc.type === "script" || doc.type === "template"
    } else if (
      currentPhase === WorkflowPhase.Packaging ||
      currentPhase === WorkflowPhase.Refinement ||
      currentPhase === WorkflowPhase.Export
    ) {
      // For other phases, don't show document tabs as they'll use the phase-specific editors
      return false
    }
    return true // Default: show all documents
  })

  return (
    <div className="flex flex-col h-full">
      {filteredDocuments.length > 0 && (
        <div className="border-b">
          <Tabs value={activeDocumentId} onValueChange={setActiveDocumentId} className="overflow-x-auto">
            <TabsList className="flex w-full">
              {filteredDocuments.map((doc) => (
                <React.Fragment key={doc.id}>
                  <TabsTrigger
                    value={doc.id}
                    className="flex-shrink-0 relative group"
                    data-active={doc.id === activeDocumentId}
                  >
                    {doc.title}
                  </TabsTrigger>
                  {doc.id === activeDocumentId && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteDocument(doc.id)
                      }}
                      className="cursor-pointer inline-flex items-center justify-center h-8 px-1 text-sm hover:text-red-500 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </span>
                  )}
                </React.Fragment>
              ))}
              <button
                type="button"
                onClick={handleNewDocument}
                className="inline-flex items-center justify-center h-8 px-2 text-sm font-medium border border-transparent"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {activeDocument && (
          <DocumentEditor
            document={activeDocument}
            onContentChange={handleContentChange}
            onTitleChange={onTitleChange}
            currentPhase={currentPhase}
            isSplitView={isSplitView}
          />
        )}
      </div>
    </div>
  )
}

