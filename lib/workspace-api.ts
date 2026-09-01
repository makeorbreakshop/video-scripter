import type { DocumentType } from "@/types/workflow"

export interface WorkspaceProjectRow {
  id: string
  name: string
  created_at: string
  updated_at: string
}

export interface WorkspaceDocumentRow {
  id: string
  title: string
  type: DocumentType
  content: string
  project_id: string
  created_at: string
  updated_at: string
}

export interface WorkspaceScriptDataRow {
  id: string
  project_id: string
  data: unknown
  created_at: string
  updated_at: string
}

async function workspaceRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `Workspace request failed (${response.status})`)
  }

  return payload as T
}

export const workspaceApi = {
  listProjects(limit = 50) {
    return workspaceRequest<{ projects: WorkspaceProjectRow[] }>(
      `/api/workspace?resource=projects&limit=${limit}`,
    ).then(({ projects }) => projects)
  },

  listDocuments(projectId: string) {
    return workspaceRequest<{ documents: WorkspaceDocumentRow[] }>(
      `/api/workspace?resource=documents&projectId=${encodeURIComponent(projectId)}`,
    ).then(({ documents }) => documents)
  },

  getScriptData(projectId: string) {
    return workspaceRequest<{ scriptData: WorkspaceScriptDataRow | null }>(
      `/api/workspace?resource=script-data&projectId=${encodeURIComponent(projectId)}`,
    ).then(({ scriptData }) => scriptData)
  },

  createDefaultWorkspace(name: string, scriptData: unknown) {
    return workspaceRequest<{
      project: WorkspaceProjectRow
      document: WorkspaceDocumentRow
      scriptData: WorkspaceScriptDataRow
    }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "create-default-workspace", name, scriptData }),
    })
  },

  createProject(name: string) {
    return workspaceRequest<{ project: WorkspaceProjectRow }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "create-project", name }),
    }).then(({ project }) => project)
  },

  renameProject(id: string, name: string) {
    return workspaceRequest<{ project: WorkspaceProjectRow }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "rename-project", id, name }),
    }).then(({ project }) => project)
  },

  deleteProject(id: string) {
    return workspaceRequest<{ ok: true }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "delete-project", id }),
    })
  },

  createDocument(projectId: string, title: string, type: DocumentType, content: string) {
    return workspaceRequest<{ document: WorkspaceDocumentRow }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "create-document", projectId, title, type, content }),
    }).then(({ document }) => document)
  },

  updateDocument(id: string, updates: { title?: string; type?: DocumentType; content?: string }) {
    return workspaceRequest<{ document: WorkspaceDocumentRow }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "update-document", id, updates }),
    }).then(({ document }) => document)
  },

  deleteDocument(id: string) {
    return workspaceRequest<{ ok: true }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "delete-document", id }),
    })
  },

  saveScriptData(projectId: string, data: unknown) {
    return workspaceRequest<{ scriptData: WorkspaceScriptDataRow }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({ action: "save-script-data", projectId, data }),
    }).then(({ scriptData }) => scriptData)
  },
}
