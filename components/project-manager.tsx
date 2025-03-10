"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Folder, FolderPlus, Edit2, Trash2, X } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/auth-context"

export interface Project {
  id: string
  name: string
  created_at: Date
  updated_at: Date
}

interface ProjectManagerProps {
  isOpen: boolean
  onClose: () => void
  currentProject: Project | null
  onOpenProject: (project: Project) => void
}

export function ProjectManager({ isOpen, onClose, currentProject, onOpenProject }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [newProjectName, setNewProjectName] = useState("")
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [editName, setEditName] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()
  const { user } = useAuth()

  // Fetch projects when the component mounts
  useEffect(() => {
    if (user && isOpen) {
      fetchProjects()
    }
  }, [user, isOpen])

  const fetchProjects = async () => {
    if (!user) return

    setIsLoading(true)

    try {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })

      if (error) throw error

      setProjects(
        data.map((project) => ({
          ...project,
          created_at: new Date(project.created_at),
          updated_at: new Date(project.updated_at),
        })),
      )
    } catch (error) {
      console.error("Error fetching projects:", error)
      toast({
        description: "Failed to load projects",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateProject = async () => {
    if (!user) return
    if (!newProjectName.trim()) {
      toast({
        description: "Please enter a project name",
      })
      return
    }

    try {
      const now = new Date().toISOString()

      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: newProjectName,
          user_id: user.id,
          created_at: now,
          updated_at: now,
        })
        .select()

      if (error) throw error

      if (data && data[0]) {
        const newProject = {
          ...data[0],
          created_at: new Date(data[0].created_at),
          updated_at: new Date(data[0].updated_at),
        }

        setProjects([newProject, ...projects])
        setNewProjectName("")

        toast({
          description: "Project created successfully",
        })
      }
    } catch (error) {
      console.error("Error creating project:", error)
      toast({
        description: "Failed to create project",
      })
    }
  }

  const handleRenameProject = async () => {
    if (!user || !editingProject) return
    if (!editName.trim()) {
      toast({
        description: "Please enter a project name",
      })
      return
    }

    try {
      const { error } = await supabase
        .from("projects")
        .update({
          name: editName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingProject.id)
        .eq("user_id", user.id)

      if (error) throw error

      setProjects(
        projects.map((project) =>
          project.id === editingProject.id ? { ...project, name: editName, updated_at: new Date() } : project,
        ),
      )

      setEditingProject(null)

      toast({
        description: "Project renamed successfully",
      })
    } catch (error) {
      console.error("Error renaming project:", error)
      toast({
        description: "Failed to rename project",
      })
    }
  }

  const startRenaming = (project: Project) => {
    setEditingProject(project)
    setEditName(project.name)
  }

  const confirmDelete = async (project: Project) => {
    if (!user) return

    if (window.confirm(`Are you sure you want to delete "${project.name}"? This action cannot be undone.`)) {
      try {
        // Delete all documents associated with this project
        const { error: docsError } = await supabase
          .from("documents")
          .delete()
          .eq("project_id", project.id)
          .eq("user_id", user.id)

        if (docsError) throw docsError

        // Delete script data associated with this project
        const { error: scriptError } = await supabase
          .from("script_data")
          .delete()
          .eq("project_id", project.id)
          .eq("user_id", user.id)

        if (scriptError) throw scriptError

        // Delete the project
        const { error } = await supabase.from("projects").delete().eq("id", project.id).eq("user_id", user.id)

        if (error) throw error

        setProjects(projects.filter((p) => p.id !== project.id))

        toast({
          description: "Project deleted successfully",
        })
      } catch (error) {
        console.error("Error deleting project:", error)
        toast({
          description: "Failed to delete project",
        })
      }
    }
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">Project Manager</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Create new project */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Create New Project</h3>
            <div className="flex gap-2">
              <Input
                placeholder="Enter project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleCreateProject}>
                <FolderPlus className="h-4 w-4 mr-2" />
                Create
              </Button>
            </div>
          </div>

          {/* Project list */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Your Projects</h3>
            {isLoading ? (
              <div className="flex justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
              </div>
            ) : projects.length > 0 ? (
              <div className="space-y-2">
                {projects.map((project) => (
                  <Card key={project.id} className="p-4">
                    {editingProject?.id === project.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          autoFocus
                          className="flex-1"
                        />
                        <Button size="sm" onClick={handleRenameProject}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingProject(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Folder className="h-5 w-5 text-primary" />
                          <div>
                            <h4 className="font-medium">{project.name}</h4>
                            <p className="text-xs text-muted-foreground">
                              Last modified: {formatDate(project.updated_at)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onOpenProject(project)}
                            disabled={currentProject?.id === project.id}
                          >
                            {currentProject?.id === project.id ? "Current" : "Open"}
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => startRenaming(project)}>
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => confirmDelete(project)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-md">
                <Folder className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground text-center">
                  No projects yet. Create your first project to get started.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

