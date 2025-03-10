"use client"

import { useState, useRef, useEffect } from "react"
import { Sidebar } from "@/components/sidebar"
import { DocumentPanel } from "@/components/document-panel"
import { EditorPanel } from "@/components/editor-panel"
import { ResourcePanel } from "@/components/resource-panel"
import { ProjectManager, type Project } from "@/components/project-manager"
import { WorkflowPhase, type Document, type DocumentType } from "@/types/workflow"
import { Maximize2, SplitSquareVertical, SplitSquareHorizontal } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/auth-context"
import { useToast } from "@/components/ui/use-toast"

export function EditorLayout() {
  const { user } = useAuth()
  const { toast } = useToast()
  const [currentPhase, setCurrentPhase] = useState<WorkflowPhase>(WorkflowPhase.Research)
  const [resourcePanelWidth, setResourcePanelWidth] = useState(350)
  const [isResizing, setIsResizing] = useState(false)
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const minResourceWidth = 260
  const maxResourceWidth = typeof window !== 'undefined' ? window.innerWidth * 0.4 : 800 // Max 40% of screen width

  // Project management state
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProject] = useState<Project | null>(null)
  const [isProjectManagerOpen, setIsProjectManagerOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Script data state with properly initialized values
  const [scriptData, setScriptData] = useState({
    research: {
      videoUrls: [],
      notes: "",
      summary: "",
      analyzedVideos: [],
      analysis: {
        contentCoverage: [],
        audienceReactions: [],
        commonQuestions: [],
        contentSuggestions: [],
        isProcessed: false,
      },
    },
    packaging: {
      titles: [],
      thumbnailConcepts: [],
      videoUrls: [],
      ideas: [],
      videoAnalysis: null,
    },
    scripting: {
      introBrick: {
        hook: "",
        problem: "",
        setup: "",
        credibility: "",
        transition: "",
      },
      middleBricks: [],
      endBrick: {
        transition: "",
        callToAction: "",
      },
    },
    refinement: {
      feedback: [],
      checklist: {
        "title-thumbnail": false,
        "language-simplicity": false,
        "sentence-length": false,
        transitions: false,
        "beginner-friendly": false,
        repetition: false,
      },
    },
    export: {
      format: "plain",
    },
  })

  // Document state
  const [documents, setDocuments] = useState<Document[]>([])
  const [activeDocumentId, setActiveDocumentId] = useState<string>("")

  // Split view state
  const [splitView, setSplitView] = useState<{
    enabled: boolean
    direction: "horizontal" | "vertical"
    primaryDocId: string
    secondaryDocId: string | null
    splitRatio: number
  }>({
    enabled: false,
    direction: "vertical",
    primaryDocId: "",
    secondaryDocId: null,
    splitRatio: 0.5, // 50/50 split by default
  })

  // Fetch initial data
  useEffect(() => {
    if (user) {
      fetchInitialData()
    }
  }, [user])

  const fetchInitialData = async () => {
    if (!user) return

    setIsLoading(true)

    try {
      console.log("Attempting to connect to Supabase:", 
        supabase ? "Client initialized" : "Client missing",
        user ? "User authenticated (ID: " + user.id + ")" : "No user"
      )

      // Fetch projects
      console.log("Fetching projects");
      const { data: projectsData, error: projectsError } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(10)

      if (projectsError) {
        console.error("Project fetch error details:", {
          code: projectsError.code,
          message: projectsError.message,
          details: projectsError.details,
          hint: projectsError.hint
        })
        throw projectsError
      }

      console.log("Projects found:", projectsData?.length || 0);

      // If no projects exist, create a default one
      if (!projectsData || projectsData.length === 0) {
        console.log("No projects found, creating default project")
        await createDefaultProject()
        return
      }

      const project = {
        ...projectsData[0],
        created_at: new Date(projectsData[0].created_at),
        updated_at: new Date(projectsData[0].updated_at),
      }

      console.log("Successfully fetched project:", project.id)
      setCurrentProject(project)

      // Fetch documents for this project
      await fetchDocuments(project.id)

      // Fetch script data for this project
      await fetchScriptData(project.id)
    } catch (error) {
      // Enhanced error logging
      console.error("Error fetching initial data:", error)
      if (error instanceof Error) {
        console.error("Error name:", error.name)
        console.error("Error message:", error.message)
        console.error("Error stack:", error.stack)
      }
      
      // Try creating a default project as fallback
      console.log("Creating default project due to error")
      try {
        await createDefaultProject()
      } catch (fallbackError) {
        console.error("Failed to create default project:", fallbackError)
        toast({
          description: "Failed to load or create project data. Please check console for details.",
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const createDefaultProject = async () => {
    if (!user) {
      console.error("Cannot create default project: No user available")
      return
    }

    try {
      console.log("Starting to create default project for user:", user.id)
      const now = new Date().toISOString()

      // Create a default project
      console.log("Inserting default project into database")
      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .insert({
          name: "My First Project",
          user_id: user.id,
          created_at: now,
          updated_at: now,
        })
        .select()

      if (projectError) {
        console.error("Error creating default project:", projectError)
        throw projectError
      }

      if (!projectData || projectData.length === 0) {
        console.error("No project data returned after insert")
        throw new Error("Failed to create project - no data returned")
      }

      console.log("Default project created successfully:", projectData[0].id)
      const project = {
        ...projectData[0],
        created_at: new Date(projectData[0].created_at),
        updated_at: new Date(projectData[0].updated_at),
      }

      setCurrentProject(project)

      // Create a default document
      console.log("Creating default document for project:", project.id)
      const { data: docData, error: docError } = await supabase
        .from("documents")
        .insert({
          title: "Personal Notes",
          type: "notes",
          content: "",
          project_id: project.id,
          user_id: user.id,
          created_at: now,
          updated_at: now,
        })
        .select()

      if (docError) {
        console.error("Error creating default document:", docError)
        throw docError
      }

      if (!docData || docData.length === 0) {
        console.error("No document data returned after insert")
        throw new Error("Failed to create document - no data returned")
      }

      console.log("Default document created successfully:", docData[0].id)
      const document = {
        ...docData[0],
        createdAt: new Date(docData[0].created_at),
        updatedAt: new Date(docData[0].updated_at),
      }

      setDocuments([document])
      setActiveDocumentId(document.id)
      setSplitView({
        ...splitView,
        primaryDocId: document.id,
      })

      // Create default script data
      console.log("Creating default script data for project:", project.id)
      const { data: scriptDataResult, error: scriptError } = await supabase
        .from("script_data")
        .insert({
          project_id: project.id,
          user_id: user.id,
          data: scriptData,
          created_at: now,
          updated_at: now,
        })
        .select()

      if (scriptError) {
        console.error("Error creating default script data:", scriptError)
        throw scriptError
      }

      console.log("Default setup completed successfully")
      return project
    } catch (error) {
      console.error("Error in createDefaultProject:", error)
      // Rethrow to allow caller to handle
      throw error
    }
  }

  const fetchDocuments = async (projectId: string) => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })

      if (error) throw error

      if (data) {
        const formattedDocs = data.map((doc) => ({
          id: doc.id,
          title: doc.title,
          type: doc.type as DocumentType,
          content: doc.content,
          createdAt: new Date(doc.created_at),
          updatedAt: new Date(doc.updated_at),
        }))

        setDocuments(formattedDocs)

        // Set active document
        if (formattedDocs.length > 0) {
          setActiveDocumentId(formattedDocs[0].id)
          setSplitView({
            ...splitView,
            primaryDocId: formattedDocs[0].id,
          })
        }
      }
    } catch (error) {
      console.error("Error fetching documents:", error)
      toast({
        description: "Failed to load documents",
      })
    }
  }

  const fetchScriptData = async (projectId: string) => {
    if (!user) return

    try {
      const { data, error } = await supabase
        .from("script_data")
        .select("*")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .single()

      if (error) {
        if (error.code === "PGRST116") {
          // No script data found, create default
          await supabase.from("script_data").insert({
            project_id: projectId,
            user_id: user.id,
            data: scriptData,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
        } else {
          throw error
        }
      } else if (data) {
        setScriptData(data.data)
      }
    } catch (error) {
      console.error("Error fetching script data:", error)
      toast({
        description: "Failed to load script data",
      })
    }
  }

  const updateScriptData = async (updates: any) => {
    if (!user || !currentProject) return

    const updatedData = { ...scriptData, ...updates }
    setScriptData(updatedData)

    try {
      const { error } = await supabase
        .from("script_data")
        .update({
          data: updatedData,
          updated_at: new Date().toISOString(),
        })
        .eq("project_id", currentProject.id)
        .eq("user_id", user.id)

      if (error) throw error
    } catch (error) {
      console.error("Error updating script data:", error)
      toast({
        description: "Failed to save script data",
      })
    }
  }

  const createProject = async (name: string) => {
    if (!user) return null

    try {
      const now = new Date().toISOString()

      const { data, error } = await supabase
        .from("projects")
        .insert({
          name,
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

        setProjects([...projects, newProject])
        setIsProjectManagerOpen(false)
        return newProject
      }
    } catch (error) {
      console.error("Error creating project:", error)
      toast({
        description: "Failed to create project",
      })
    }

    return null
  }

  const openProject = async (project: Project) => {
    setCurrentProject(project)
    setIsProjectManagerOpen(false)

    // Clear current state
    setDocuments([])
    setActiveDocumentId("")
    setSplitView({
      ...splitView,
      primaryDocId: "",
      secondaryDocId: null,
      enabled: false,
    })

    // Fetch documents for this project
    await fetchDocuments(project.id)

    // Fetch script data for this project
    await fetchScriptData(project.id)
  }

  // Update document function
  const updateDocument = async (id: string, updates: Partial<Document>) => {
    console.log(`[Update Document] Updating document ${id}`);
    if (updates.content) {
      console.log(`[Update Document] Content length: ${updates.content.length}`);
      console.log(`[Update Document] Content preview: "${updates.content.substring(0, 100)}..."`);
    }
    
    // First find the document in our state
    const documentToUpdate = documents.find(doc => doc.id === id);
    if (!documentToUpdate) {
      console.error(`[Update Document] Document ${id} not found in state`);
      return;
    }
    
    // First update the document in state for immediate UI feedback
    const updatedDocuments = documents.map((doc) => {
      if (doc.id === id) {
        // Create merged document with new updates
        const updatedDoc = { 
          ...doc, 
          ...updates, 
          updatedAt: new Date(),
          // Ensure content is properly updated
          content: updates.content !== undefined ? updates.content : doc.content
        };
        console.log(`[Update Document] Updated document in state: ${updatedDoc.title}`);
        console.log(`[Update Document] Content length in state: ${updatedDoc.content?.length || 0}`);
        return updatedDoc;
      }
      return doc;
    });
    
    // Set state explicitly first for immediate feedback
    setDocuments(updatedDocuments);
    
    // Then update in database if user is logged in
    if (!user || !currentProject) {
      console.log(`[Update Document] No user/project, document updated only in state`);
      return;
    }

    try {
      console.log(`[Update Document] Saving to database...`);
      // Create the update payload with proper values
      const updatePayload: any = {
        ...updates,
        updated_at: new Date().toISOString(),
      };
      
      // Ensure content is properly included in the database update
      if (updates.content !== undefined) {
        updatePayload.content = updates.content;
        console.log(`[Update Document] Including content in DB update, length: ${updates.content.length}`);
      }
      
      const { error } = await supabase
        .from("documents")
        .update(updatePayload)
        .eq("id", id);

      if (error) {
        console.error(`[Update Document] Error updating in database:`, error);
        throw error;
      }
      
      console.log(`[Update Document] Successfully saved to database`);
    } catch (error) {
      console.error(`[Update Document] Error:`, error);
      toast({
        title: "Error",
        description: "Failed to save document",
        variant: "destructive",
      });
    }
  };

  // Delete document
  const deleteDocument = async (id: string) => {
    if (!user || !currentProject) return

    // Don't delete if it's the last document
    if (documents.length <= 1) {
      toast({
        description: "Cannot delete the last document",
      })
      return
    }

    try {
      const { error } = await supabase.from("documents").delete().eq("id", id).eq("user_id", user.id)

      if (error) throw error

      const newDocs = documents.filter((doc) => doc.id !== id)
      setDocuments(newDocs)

      // If we're deleting the active document, set a new active document
      if (activeDocumentId === id) {
        setActiveDocumentId(newDocs[0].id)
      }

      // If we're deleting a document in split view, update split view
      if (splitView.primaryDocId === id || splitView.secondaryDocId === id) {
        setSplitView({
          ...splitView,
          primaryDocId: splitView.primaryDocId === id ? (newDocs[0]?.id || "") : splitView.primaryDocId,
          secondaryDocId: splitView.secondaryDocId === id ? null : splitView.secondaryDocId,
        })
      }
    } catch (error) {
      console.error("Error deleting document:", error)
      toast({
        description: "Failed to delete document",
      })
    }
  }

  // Handle mouse events for resizing workspace panel
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return

      const containerRect = containerRef.current.getBoundingClientRect()
      const newWidth = containerRect.right - e.clientX

      if (newWidth >= minResourceWidth && newWidth <= maxResourceWidth) {
        setResourcePanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.classList.remove("resizing")
    }

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.classList.add("resizing")
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.classList.remove("resizing")
    }
  }, [isResizing, maxResourceWidth])

  // Start resizing workspace panel
  const startResize = () => {
    setIsResizing(true)
  }

  // Create a new document - simplified minimal version
  const createDocument = async (type: DocumentType, title = "Untitled", initialContent = ""): Promise<Document> => {
    console.log(`Creating document "${title}" with content length: ${initialContent.length}`);
    
    // If no user/project, create local document
    if (!user || !currentProject) {
      const localDoc: Document = {
        id: `local-${Date.now()}`,
        title,
        type,
        content: initialContent,
        createdAt: new Date(),
        updatedAt: new Date(),
        save: async function() { return this; }
      };
      
      // Update state
      setDocuments([...documents, localDoc]);
      setActiveDocumentId(localDoc.id);
      
      return localDoc;
    }

    try {
      // Create in database with content
      const { data, error } = await supabase
        .from("documents")
        .insert({
          title,
          type,
          content: initialContent,
          project_id: currentProject.id,
          user_id: user.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select();

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Document creation failed - no data returned");
      }

      // Create document object
      const newDocument: Document = {
        id: data[0].id,
        title: data[0].title,
        type: data[0].type as DocumentType,
        content: initialContent, // Use initialContent directly
        createdAt: new Date(data[0].created_at),
        updatedAt: new Date(data[0].updated_at),
        save: async function() {
          try {
            const { error } = await supabase
              .from("documents")
              .update({
                content: this.content,
                updated_at: new Date().toISOString(),
              })
              .eq("id", this.id);
            
            if (error) throw error;
            
            // Update state
            setDocuments(docs => 
              docs.map(d => d.id === this.id ? {...d, content: this.content, updatedAt: new Date()} : d)
            );
            
            return this;
          } catch (error) {
            console.error("Save error:", error);
            throw error;
          }
        }
      };
      
      // Update state 
      setDocuments([...documents, newDocument]);
      setActiveDocumentId(newDocument.id);
      
      return newDocument;
    } catch (error) {
      console.error("Document creation error:", error);
      toast({
        title: "Error",
        description: "Failed to create document",
        variant: "destructive",
      });
      throw error;
    }
  };

  // Toggle split view
  const toggleSplitView = (direction: "horizontal" | "vertical") => {
    if (splitView.enabled && splitView.direction === direction) {
      // Disable split view if already enabled with same direction
      setSplitView({
        ...splitView,
        enabled: false,
        secondaryDocId: null,
      })
    } else {
      // Enable or change direction
      setSplitView({
        ...splitView,
        enabled: true,
        direction,
        primaryDocId: activeDocumentId,
        secondaryDocId: documents.find((doc) => doc.id !== activeDocumentId)?.id || null,
      })
    }
  }

  // Set secondary document in split view
  const setSecondaryDocument = (docId: string) => {
    setSplitView({
      ...splitView,
      secondaryDocId: docId,
    })
  }

  // Handle split view resize
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const splitResizeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSplit || !splitResizeRef.current) return

      const containerRect = splitResizeRef.current.parentElement?.getBoundingClientRect()
      if (!containerRect) return

      let ratio
      if (splitView.direction === "vertical") {
        ratio = (e.clientX - containerRect.left) / containerRect.width
      } else {
        ratio = (e.clientY - containerRect.top) / containerRect.height
      }

      // Limit ratio between 0.2 and 0.8
      ratio = Math.max(0.2, Math.min(0.8, ratio))

      setSplitView({
        ...splitView,
        splitRatio: ratio,
      })
    }

    const handleMouseUp = () => {
      setIsResizingSplit(false)
      document.body.classList.remove("resizing-split")
    }

    if (isResizingSplit) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.classList.add("resizing-split")
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.classList.remove("resizing-split")
    }
  }, [isResizingSplit, splitView])

  // Start resizing split view
  const startResizeSplit = () => {
    setIsResizingSplit(true)
  }

  // Add this effect to handle phase transitions
  useEffect(() => {
    // When entering the Scripting phase, ensure a script document exists and is active
    if (currentPhase === WorkflowPhase.Scripting) {
      // Check if a script document already exists
      const scriptDoc = documents.find((doc) => doc.type === "script")

      if (scriptDoc) {
        // If a script document exists, set it as active
        setActiveDocumentId(scriptDoc.id)
      } else if (documents.length > 0) {
        // If no script document exists, create one
        createDocument("script", "Script Document")
      }
    }
  }, [currentPhase, documents]) // Only run this effect when the phase changes

  // Wrapper for createDocument that provides a synchronous interface
  // @ts-ignore - We need this to satisfy the type system even though it doesn't match the actual implementation
  const createDocumentSync = (type: DocumentType, title?: string): Document => {
    // Create a temporary document ID that will be used until the async operation completes
    const tempId = `temp-${Date.now()}`;
    const tempDocument: Document = {
      id: tempId,
      title: title || "Untitled",
      type,
      content: "",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Start the async operation in the background
    createDocument(type, title).then(actualDoc => {
      // Once the real document is created, we can update the documents list
      const docIndex = documents.findIndex(d => d.id === tempId);
      if (docIndex >= 0) {
        const newDocs = [...documents];
        newDocs[docIndex] = actualDoc;
        setDocuments(newDocs);
        setActiveDocumentId(actualDoc.id);
      }
    }).catch(error => {
      console.error("Error in background document creation:", error);
    });
    
    // Return the temporary document immediately
    return tempDocument;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="app-container">
      {/* Left sidebar */}
      <Sidebar
        currentPhase={currentPhase}
        setCurrentPhase={setCurrentPhase}
        isMinimized={isSidebarMinimized}
        toggleMinimized={() => setIsSidebarMinimized(!isSidebarMinimized)}
        openProjectManager={() => setIsProjectManagerOpen(true)}
      />

      {/* Center document panel */}
      <div className="document-container">
        {/* Top header with project name and split view controls */}
        <div className="document-header">
          <div className="flex items-center justify-between w-full px-4">
            <div className="text-lg font-medium truncate">{currentProject?.name || "Loading..."}</div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => toggleSplitView("vertical")}
                className={`p-1.5 rounded ${splitView.enabled && splitView.direction === "vertical" ? "bg-secondary" : ""}`}
                title="Split vertically"
              >
                <SplitSquareVertical className="h-4 w-4" />
              </button>
              <button
                onClick={() => toggleSplitView("horizontal")}
                className={`p-1.5 rounded ${splitView.enabled && splitView.direction === "horizontal" ? "bg-secondary" : ""}`}
                title="Split horizontally"
              >
                <SplitSquareHorizontal className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSplitView({ ...splitView, enabled: false })}
                className="p-1.5 rounded"
                title="Single view"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Document content */}
        <div className="document-content">
          {currentPhase === WorkflowPhase.Scripting || currentPhase === WorkflowPhase.Research ? (
            <div className="grid h-full" style={{ gridTemplateColumns: splitView.enabled ? "1fr" : "1fr", gridTemplateRows: splitView.enabled ? (splitView.direction === "horizontal" ? `${splitView.splitRatio * 100}% 8px ${(1 - splitView.splitRatio) * 100}%` : "1fr") : "1fr" }}>
              {splitView.enabled ? (
                <>
                  <div className="relative overflow-hidden">
                    {documents.find(d => d.id === splitView.primaryDocId) && (
                      <DocumentPanel
                        documents={documents}
                        activeDocumentId={splitView.primaryDocId}
                        setActiveDocumentId={setActiveDocumentId}
                        updateDocument={updateDocument}
                        createDocument={createDocumentSync}
                        deleteDocument={deleteDocument}
                        currentPhase={currentPhase}
                        isSplitView={true}
                      />
                    )}
                  </div>
                  
                  <div
                    className={`${splitView.direction === "horizontal" ? "w-full cursor-ns-resize" : "h-full cursor-ew-resize"} bg-muted`}
                    onMouseDown={startResizeSplit}
                  />
                  
                  <div className="relative overflow-hidden">
                    {splitView.secondaryDocId && documents.find(d => d.id === splitView.secondaryDocId) && (
                      <DocumentPanel
                        documents={documents}
                        activeDocumentId={splitView.secondaryDocId}
                        setActiveDocumentId={setActiveDocumentId}
                        updateDocument={updateDocument}
                        createDocument={createDocumentSync}
                        deleteDocument={deleteDocument}
                        currentPhase={currentPhase}
                        isSplitView={true}
                      />
                    )}
                  </div>
                </>
              ) : (
                <DocumentPanel
                  documents={documents}
                  activeDocumentId={activeDocumentId}
                  setActiveDocumentId={setActiveDocumentId}
                  updateDocument={updateDocument}
                  createDocument={createDocumentSync}
                  deleteDocument={deleteDocument}
                  currentPhase={currentPhase}
                  isSplitView={false}
                />
              )}
            </div>
          ) : (
            // For phases other than Scripting and Research, show the EditorPanel
            <div className="editor-container">
              <EditorPanel currentPhase={currentPhase} scriptData={scriptData} updateScriptData={updateScriptData} />
            </div>
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="resize-handle cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
        onMouseDown={startResize}
      ></div>

      {/* Right resource panel */}
      <div
        className="relative border-l overflow-y-auto"
        style={{ width: `${resourcePanelWidth}px` }}
      >
        <ResourcePanel
          currentPhase={currentPhase}
          documents={documents}
          activeDocumentId={activeDocumentId}
          setActiveDocumentId={setActiveDocumentId}
          createDocument={createDocumentSync}
          deleteDocument={deleteDocument}
          panelWidth={resourcePanelWidth}
          splitView={splitView}
          setSecondaryDocument={setSecondaryDocument}
          scriptData={scriptData}
          updateScriptData={updateScriptData}
        />
      </div>

      {/* Project Manager Dialog */}
      <ProjectManager
        isOpen={isProjectManagerOpen}
        onClose={() => setIsProjectManagerOpen(false)}
        currentProject={currentProject}
        onOpenProject={openProject}
      />
    </div>
  )
}

