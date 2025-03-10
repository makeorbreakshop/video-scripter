"use client"

import { useState, useEffect } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Heading from "@tiptap/extension-heading"
import type { ScriptingData } from "@/types/workflow"
import { formatWordCount } from "@/lib/utils"
import { Bold, Italic, Heading1, Heading2, Heading3 } from "lucide-react"

interface ScriptingEditorProps {
  data: ScriptingData
  updateData: (data: ScriptingData) => void
}

export function ScriptingEditor({ data, updateData }: ScriptingEditorProps) {
  const [scriptTitle, setScriptTitle] = useState("Untitled Script")
  const [scriptContent, setScriptContent] = useState("")

  // Initialize the editor content from the script data
  useEffect(() => {
    // Combine all script parts into a single document
    const introParts = [
      data.introBrick.hook,
      data.introBrick.problem,
      data.introBrick.setup,
      data.introBrick.credibility,
      data.introBrick.transition,
    ]
      .filter(Boolean)
      .join("\n\n")

    const middleParts = data.middleBricks
      .map((brick) => {
        return [brick.transition, brick.example, brick.application, brick.nextTransition].filter(Boolean).join("\n\n")
      })
      .join("\n\n")

    const endParts = [data.endBrick.transition, data.endBrick.callToAction].filter(Boolean).join("\n\n")

    // Only set initial content if the editor is empty and we have content
    if (!scriptContent && (introParts || middleParts || endParts)) {
      const fullScript = `<h1>Introduction</h1>
${introParts ? `<p>${introParts.replace(/\n\n/g, "</p><p>")}</p>` : ""}

<h1>Main Content</h1>
${middleParts ? `<p>${middleParts.replace(/\n\n/g, "</p><p>")}</p>` : ""}

<h1>Conclusion</h1>
${endParts ? `<p>${endParts.replace(/\n\n/g, "</p><p>")}</p>` : ""}`

      setScriptContent(fullScript)
    }
  }, [data, scriptContent])

  // Configure TipTap editor
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Heading.configure({
        levels: [1, 2, 3],
      }),
      Placeholder.configure({
        placeholder: "Start writing your script here...",
      }),
    ],
    content: scriptContent,
    onUpdate: ({ editor }) => {
      setScriptContent(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: "craft-editor",
      },
    },
  })

  // Extract plain text for word count
  const getPlainText = () => {
    if (editor) {
      return editor.getText()
    }
    return ""
  }

  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Document title */}
      <input
        type="text"
        value={scriptTitle}
        onChange={(e) => setScriptTitle(e.target.value)}
        className="text-2xl font-light w-full mb-1 focus:outline-none"
        placeholder="Untitled Script"
      />

      {/* Word count */}
      <div className="text-sm text-muted-foreground mb-6">{formatWordCount(getPlainText())}</div>

      {/* Minimal formatting toolbar */}
      <div className="flex items-center space-x-1 mb-4 border-b border-border pb-2">
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded ${editor?.isActive("heading", { level: 1 }) ? "bg-secondary" : ""}`}
        >
          <Heading1 className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-1.5 rounded ${editor?.isActive("heading", { level: 2 }) ? "bg-secondary" : ""}`}
        >
          <Heading2 className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-1.5 rounded ${editor?.isActive("heading", { level: 3 }) ? "bg-secondary" : ""}`}
        >
          <Heading3 className="h-4 w-4" />
        </button>
        <div className="w-px h-4 bg-border mx-1"></div>
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded ${editor?.isActive("bold") ? "bg-secondary" : ""}`}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded ${editor?.isActive("italic") ? "bg-secondary" : ""}`}
        >
          <Italic className="h-4 w-4" />
        </button>
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} className="prose prose-invert max-w-none" />
    </div>
  )
}

