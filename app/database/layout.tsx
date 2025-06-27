"use client";

import React, { useState } from "react";
import { Search, FileText, Package, Edit2, Download, Settings, ChevronLeft, ChevronRight, Folder, Database, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import Link from "next/link";

export default function DatabaseLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [isMinimized, setIsMinimized] = useState(false);
  
  const toggleMinimized = () => {
    setIsMinimized(!isMinimized);
  };

  return (
    <div className="flex h-screen bg-black">
      {/* Sidebar */}
      <TooltipProvider>
        <div className={cn(
          "h-full bg-gray-950 border-r border-gray-800 flex flex-col transition-all duration-200",
          isMinimized ? "w-14" : "w-48"
        )}>
          {/* Logo or app icon */}
          <div className="mb-6 mt-4 flex items-center px-3">
            <Link href="/">
              <div className="flex items-center">
                <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center">
                  <span className="text-xs font-bold text-white">YT</span>
                </div>
                {!isMinimized && <span className="ml-3 font-medium text-white">Script Editor</span>}
              </div>
            </Link>
          </div>

          {/* Navigation items */}
          <div className="flex-1 flex flex-col space-y-1 px-3">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Search className="h-5 w-5" />
                    {!isMinimized && <span className="ml-3">Research</span>}
                  </button>
                </Link>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  Research
                </TooltipContent>
              )}
            </Tooltip>
            
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Package className="h-5 w-5" />
                    {!isMinimized && <span className="ml-3">Packaging</span>}
                  </button>
                </Link>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  Packaging
                </TooltipContent>
              )}
            </Tooltip>
            
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <FileText className="h-5 w-5" />
                    {!isMinimized && <span className="ml-3">Scripting</span>}
                  </button>
                </Link>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  Scripting
                </TooltipContent>
              )}
            </Tooltip>
            
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Edit2 className="h-5 w-5" />
                    {!isMinimized && <span className="ml-3">Refinement</span>}
                  </button>
                </Link>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  Refinement
                </TooltipContent>
              )}
            </Tooltip>
            
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Download className="h-5 w-5" />
                    {!isMinimized && <span className="ml-3">Export</span>}
                  </button>
                </Link>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  Export
                </TooltipContent>
              )}
            </Tooltip>
          </div>

          {/* Bottom actions */}
          <div className="mt-auto mb-4 px-3 space-y-1">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Folder className="h-5 w-5" />
                    {!isMinimized && <span className="ml-3">Projects</span>}
                  </button>
                </Link>
              </TooltipTrigger>
              {isMinimized && (
                <TooltipContent side="right" className="ml-1">
                  Projects
                </TooltipContent>
              )}
            </Tooltip>

            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/database" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-blue-500 bg-blue-500/10 hover:bg-blue-500/20",
                    !isMinimized && "justify-start"
                  )}>
                    <Database className="h-5 w-5" />
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

            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Link href="/dashboard/youtube" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Youtube className="h-5 w-5" />
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
                <Link href="/settings" className="w-full">
                  <button className={cn(
                    "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50",
                    !isMinimized && "justify-start"
                  )}>
                    <Settings className="h-5 w-5" />
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
            <button 
              className={cn(
                "w-full flex items-center py-2 px-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800/50", 
                !isMinimized && "justify-start"
              )} 
              onClick={toggleMinimized}
            >
              {isMinimized ? (
                <ChevronRight className="h-5 w-5" />
              ) : (
                <>
                  <ChevronLeft className="h-5 w-5" />
                  <span className="ml-3">Collapse</span>
                </>
              )}
            </button>
          </div>
        </div>
      </TooltipProvider>

      {/* Main content */}
      <div className="flex-1 h-full overflow-auto">
        {children}
      </div>
    </div>
  );
} 