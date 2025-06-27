"use client"

import { Search, FileText, Edit2, Download, Settings, ChevronLeft, ChevronRight, Package, Folder, Database, Youtube } from "lucide-react"
import { cn } from "@/lib/utils"
import { WorkflowPhase } from "@/types/workflow"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import Link from "next/link"

interface SidebarProps {
  currentPhase: WorkflowPhase
  setCurrentPhase: (phase: WorkflowPhase) => void
  isMinimized: boolean
  toggleMinimized: () => void
  openProjectManager: () => void
}

export function Sidebar({
  currentPhase,
  setCurrentPhase,
  isMinimized,
  toggleMinimized,
  openProjectManager,
}: SidebarProps) {
  const navItems = [
    {
      phase: WorkflowPhase.Research,
      icon: Search,
      label: "Research",
    },
    {
      phase: WorkflowPhase.Packaging,
      icon: Package,
      label: "Packaging",
    },
    {
      phase: WorkflowPhase.Scripting,
      icon: FileText,
      label: "Scripting",
    },
    {
      phase: WorkflowPhase.Refinement,
      icon: Edit2,
      label: "Refinement",
    },
    {
      phase: WorkflowPhase.Export,
      icon: Download,
      label: "Export",
    },
  ]

  return (
    <TooltipProvider>
      <div className={cn("sidebar", isMinimized ? "w-14" : "w-48")}>
        {/* Logo or app icon */}
        <div className="mb-6 mt-2 flex items-center px-3">
          <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
            <span className="text-xs font-medium text-primary-foreground">YT</span>
          </div>
          {!isMinimized && <span className="ml-3 font-medium">Script Editor</span>}
        </div>

        {/* Navigation items */}
        <div className="flex-1 flex flex-col items-center space-y-2 px-3">
          {navItems.map((item) => (
            <Tooltip key={item.phase} delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "sidebar-button w-full",
                    !isMinimized && "justify-start px-3",
                    currentPhase === item.phase && "active",
                  )}
                  onClick={() => setCurrentPhase(item.phase)}
                >
                  <item.icon className="sidebar-icon" />
                  {!isMinimized && <span className="ml-3">{item.label}</span>}
                </button>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  {item.label}
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </div>

        {/* Bottom actions */}
        <div className="mt-auto mb-4 px-3 space-y-2">
          {/* Project Manager Button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                className={cn("sidebar-button w-full", !isMinimized && "justify-start px-3")}
                onClick={openProjectManager}
              >
                <Folder className="sidebar-icon" />
                {!isMinimized && <span className="ml-3">Projects</span>}
              </button>
            </TooltipTrigger>
            {isMinimized && (
              <TooltipContent side="right" className="ml-1">
                Projects
              </TooltipContent>
            )}
          </Tooltip>

          {/* Database Button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/database">
                <button className={cn("sidebar-button w-full", !isMinimized && "justify-start px-3")}>
                  <Database className="sidebar-icon" />
                  {!isMinimized && <span className="ml-3">Database</span>}
                </button>
              </Link>
            </TooltipTrigger>
            {isMinimized && (
              <TooltipContent side="right" className="ml-1">
                Database
              </TooltipContent>
            )}
          </Tooltip>

          {/* YouTube Dashboard Button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/dashboard/youtube">
                <button className={cn("sidebar-button w-full", !isMinimized && "justify-start px-3")}>
                  <Youtube className="sidebar-icon" />
                  {!isMinimized && <span className="ml-3">YouTube</span>}
                </button>
              </Link>
            </TooltipTrigger>
            {isMinimized && (
              <TooltipContent side="right" className="ml-1">
                YouTube Dashboard
              </TooltipContent>
            )}
          </Tooltip>

          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link href="/dashboard/settings">
                <button className={cn("sidebar-button w-full", !isMinimized && "justify-start px-3")}>
                  <Settings className="sidebar-icon" />
                  {!isMinimized && <span className="ml-3">Settings</span>}
                </button>
              </Link>
            </TooltipTrigger>
            {isMinimized && (
              <TooltipContent side="right" className="ml-1">
                Settings
              </TooltipContent>
            )}
          </Tooltip>

          {/* Toggle sidebar button */}
          <button className="sidebar-button w-full mt-2" onClick={toggleMinimized}>
            {isMinimized ? (
              <ChevronRight className="sidebar-icon" />
            ) : (
              <>
                <ChevronLeft className="sidebar-icon" />
                <span className="ml-3">Collapse</span>
              </>
            )}
          </button>
        </div>
      </div>
    </TooltipProvider>
  )
}

