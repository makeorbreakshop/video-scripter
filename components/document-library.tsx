"use client"

import type { Document, DocumentType } from "@/types/workflow"
import { FileText, Plus, Trash2, FileCode, FileSearch, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

interface DocumentLibraryProps {
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
}

export function DocumentLibrary({
  documents,
  activeDocumentId,
  setActiveDocumentId,
  createDocument,
  deleteDocument,
  panelWidth,
  splitView,
  setSecondaryDocument,
}: DocumentLibraryProps) {
  const handleCreateDocument = (type: DocumentType) => {
    const typeLabels: Record<DocumentType, string> = {
      notes: "Notes",
      analysis: "Analysis",
      script: "Script",
      research: "Research",
      template: "Template",
    }

    createDocument(type, `New ${typeLabels[type]}`)
  }

  const getDocumentIcon = (type: DocumentType) => {
    switch (type) {
      case "notes":
        return FileText
      case "analysis":
        return FileSearch
      case "script":
        return FileCode
      case "research":
        return FileSearch
      case "template":
        return FileText
      default:
        return FileText
    }
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date)
  }

  return (
    <div className="p-4 space-y-4">
      {/* Create new document buttons */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="flex items-center" onClick={() => handleCreateDocument("notes")}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Note
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center"
          onClick={() => handleCreateDocument("research")}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Research
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center"
          onClick={() => handleCreateDocument("script")}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Script
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center"
          onClick={() => handleCreateDocument("template")}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Template
        </Button>
      </div>

      {/* Document list */}
      <div className="space-y-2">
        {documents.map((doc) => {
          const DocIcon = getDocumentIcon(doc.type)
          const isActive = activeDocumentId === doc.id
          const isSecondary = splitView?.secondaryDocId === doc.id

          return (
            <Card
              key={doc.id}
              className={`p-3 cursor-pointer hover:bg-secondary/50 transition-colors ${
                isActive || isSecondary ? "bg-secondary" : ""
              }`}
              onClick={() => setActiveDocumentId(doc.id)}
            >
              <div className="flex items-start">
                <div className="h-8 w-8 rounded-md bg-secondary/80 flex items-center justify-center mr-3 flex-shrink-0">
                  <DocIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium truncate">
                    {doc.title}
                    {doc.type === "template" && <span className="ml-2 text-xs text-muted-foreground">(Template)</span>}
                  </h4>
                  <p className="text-xs text-muted-foreground">{formatDate(doc.updatedAt)}</p>
                </div>
                <div className="flex items-center">
                  {splitView?.enabled &&
                    setSecondaryDocument &&
                    doc.id !== splitView.primaryDocId &&
                    doc.id !== splitView.secondaryDocId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 mr-1"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSecondaryDocument(doc.id)
                        }}
                        title="Open in split view"
                      >
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteDocument(doc.id)
                    }}
                    title="Delete document"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

