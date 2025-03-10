"use client"

// This file is being kept for reference but is no longer used.
// The functionality has been moved directly into the document-editor.tsx
// component using TipTap's BubbleMenu for better performance.

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"
import { Bold, Italic, Heading1, Heading2, Heading3 } from "lucide-react"

interface FloatingFormatMenuProps {
  editor: Editor
}

// This component has been deprecated and replaced by the 
// EditorControls component inside document-editor.tsx
export function FloatingFormatMenu({ editor }: FloatingFormatMenuProps) {
  // Keeping the code for reference only
  return null
}

