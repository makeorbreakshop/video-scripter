import { EditorLayout } from "@/components/editor-layout"
import { ProtectedRoute } from "@/components/protected-route"

export default function Dashboard() {
  return (
    <ProtectedRoute>
      <EditorLayout />
    </ProtectedRoute>
  )
}

