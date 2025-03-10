"use client"

import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Heading from "@tiptap/extension-heading"
import type { Document, WorkflowPhase } from "@/types/workflow"
import { useEffect, useState, memo } from "react"
import { Bold, Italic, Heading1, Heading2, Heading3 } from "lucide-react"

interface DocumentEditorProps {
  document: Document
  onContentChange: (content: string) => void
  onTitleChange: (title: string) => void
  currentPhase: WorkflowPhase
  isSplitView?: boolean
}

// Simple toolbar button component 
const ToolbarButton = memo(({ icon: Icon, onClick, isActive = false, label }: any) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`p-2 rounded hover:bg-slate-800 ${isActive ? "bg-slate-800 text-blue-500" : "text-slate-400"}`}
      title={label}
    >
      <Icon className="h-5 w-5" />
    </button>
  )
})

ToolbarButton.displayName = "ToolbarButton"

// Main editor component following TipTap's recommended patterns
export function DocumentEditor({
  document,
  onContentChange,
  onTitleChange,
  currentPhase,
  isSplitView = false,
}: DocumentEditorProps) {
  // Track current document ID to detect changes
  const [currentDocId, setCurrentDocId] = useState(document.id);
  const [editorReady, setEditorReady] = useState(false);
  
  // Initialize editor with content
  const editor = useEditor({
    extensions: [
      StarterKit,
      Heading.configure({
        levels: [1, 2, 3],
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
    ],
    content: document.content || "",
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none p-4 min-h-[200px] focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      onContentChange(editor.getHTML());
    },
  });
  
  // Set editorReady when editor is available
  useEffect(() => {
    if (editor) {
      setEditorReady(true);
    }
  }, [editor]);
  
  // Handle document changes
  useEffect(() => {
    if (!editor) return;
    
    // When document changes, update content
    if (document.id !== currentDocId) {
      console.log(`Document changed to: ${document.id}, content length: ${document.content?.length || 0}`);
      editor.commands.setContent(document.content || "");
      setCurrentDocId(document.id);
    }
  }, [editor, document.id, document.content, currentDocId]);
  
  // Toolbar component
  const renderToolbar = () => {
    if (!editor) return null;

    return (
      <div className="flex flex-wrap items-center gap-1 px-4 py-1 border-b border-slate-800">
        <ToolbarButton
          icon={Bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          label="Bold"
        />
        <ToolbarButton
          icon={Italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          label="Italic"
        />
        <div className="w-px h-6 mx-1 bg-slate-800" />
        <ToolbarButton
          icon={Heading1}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive("heading", { level: 1 })}
          label="Heading 1"
        />
        <ToolbarButton
          icon={Heading2}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
          label="Heading 2"
        />
        <ToolbarButton
          icon={Heading3}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive("heading", { level: 3 })}
          label="Heading 3"
        />
      </div>
    );
  };

  return (
    <div className={`flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden ${isSplitView ? "text-sm" : ""}`}>
      <div className="px-4 py-2 border-b border-slate-800">
        <input
          type="text"
          value={document.title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="w-full bg-transparent text-lg font-medium text-white focus:outline-none"
          placeholder="Untitled"
        />
      </div>
      {renderToolbar()}
      
      {/* Editor content */}
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} />
        
        {/* Fallback content display if editor is not working properly */}
        {(!editor || !editorReady) && document.content && (
          <div className="p-4 prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: document.content }} />
        )}
      </div>
      
      {/* Content debug info */}
      <div className="text-xs p-1 bg-slate-900 text-slate-400 border-t border-slate-800">
        {document.content ? 
          `Content: ${document.content.length} characters` : 
          "No content in document"
        }
      </div>
    </div>
  );
}

