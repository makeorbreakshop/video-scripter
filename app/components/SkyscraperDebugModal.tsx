import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState, useEffect } from 'react'
import { XMarkIcon, ClipboardIcon, CheckCircleIcon, ExclamationCircleIcon, CalculatorIcon } from '@heroicons/react/24/outline'
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { InfoIcon } from "lucide-react"

// Define available Claude models with their details
const CLAUDE_MODELS = [
  { 
    id: "claude-3-7-sonnet-20240620", 
    name: "Claude 3.7 Sonnet", 
    contextWindow: 200000,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    description: "Most capable Claude model with superior intelligence and reasoning"
  },
  { 
    id: "claude-3-5-sonnet-20240620", 
    name: "Claude 3.5 Sonnet", 
    contextWindow: 200000,
    inputCostPer1kTokens: 0.0025,
    outputCostPer1kTokens: 0.0125,
    description: "Powerful model balancing intelligence and efficiency"
  },
  { 
    id: "claude-3-opus-20240229", 
    name: "Claude 3 Opus", 
    contextWindow: 200000,
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    description: "Most powerful model for complex tasks requiring deep understanding"
  },
  { 
    id: "claude-3-sonnet-20240229", 
    name: "Claude 3 Sonnet", 
    contextWindow: 200000,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    description: "Excellent balance of intelligence and speed"
  },
  { 
    id: "claude-3-haiku-20240307", 
    name: "Claude 3 Haiku", 
    contextWindow: 200000,
    inputCostPer1kTokens: 0.00025,
    outputCostPer1kTokens: 0.00125,
    description: "Fastest and most compact model for high-volume, simple tasks"
  }
];

// Helper function to estimate token count (rough approximation)
const estimateTokenCount = (text: string): number => {
  if (!text) return 0;
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
};

interface DebugModalProps {
  isOpen: boolean
  onClose: () => void
  debugData: {
    videoId: string
    videoTitle?: string
    transcriptLength?: number
    commentCount?: number
    systemPrompt?: string
    userPrompt?: string
    analysisResults?: any
    error?: string
    status: 'loading' | 'success' | 'error' | 'initial'
    reasoning?: string
  }
  onSaveAnalysis?: () => void
  onStartAnalysis?: (modelId?: string) => void
}

export default function SkyscraperDebugModal({ isOpen, onClose, debugData, onSaveAnalysis, onStartAnalysis }: DebugModalProps) {
  const [selectedModel, setSelectedModel] = useState(CLAUDE_MODELS[0].id);
  const [costEstimate, setCostEstimate] = useState({ inputCost: 0, outputCost: 0, totalCost: 0 });
  const [showReasoning, setShowReasoning] = useState(false);
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }
  
  // Calculate estimated cost whenever relevant data changes
  useEffect(() => {
    if (!debugData.transcriptLength && !debugData.commentCount) return;
    
    const selectedModelInfo = CLAUDE_MODELS.find(model => model.id === selectedModel);
    if (!selectedModelInfo) return;
    
    // Estimate input tokens (transcript + comments + prompts)
    const transcriptTokens = debugData.transcriptLength ? estimateTokenCount(debugData.transcriptLength.toString()) : 0;
    const commentTokens = debugData.commentCount ? debugData.commentCount * 200 : 0; // Rough estimate of 200 tokens per comment
    const promptTokens = estimateTokenCount(debugData.systemPrompt || '') + estimateTokenCount(debugData.userPrompt || '');
    const totalInputTokens = transcriptTokens + commentTokens + promptTokens;
    
    // Estimate output tokens (typically 20-30% of input for analysis tasks)
    const estimatedOutputTokens = Math.ceil(totalInputTokens * 0.25);
    
    // Calculate costs
    const inputCost = (totalInputTokens / 1000) * selectedModelInfo.inputCostPer1kTokens;
    const outputCost = (estimatedOutputTokens / 1000) * selectedModelInfo.outputCostPer1kTokens;
    const totalCost = inputCost + outputCost;
    
    setCostEstimate({
      inputCost,
      outputCost,
      totalCost
    });
  }, [selectedModel, debugData.transcriptLength, debugData.commentCount, debugData.systemPrompt, debugData.userPrompt]);

  // Handle model change
  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
  };

  // Get current model info
  const currentModel = CLAUDE_MODELS.find(model => model.id === selectedModel) || CLAUDE_MODELS[0];

  // Add a toggle for showing reasoning
  const toggleReasoning = () => {
    setShowReasoning(!showReasoning);
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-xl bg-white dark:bg-gray-900 shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-5xl">
                {/* Header with close button */}
                <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-6 py-4">
                  <Dialog.Title as="h3" className="text-xl font-semibold text-gray-900 dark:text-white">
                    Skyscraper Analysis Debug Info
                  </Dialog.Title>
                  <button
                    type="button"
                    className="rounded-full p-1 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>

                <div className="px-6 py-5">
                  {/* Status indicator */}
                  <div className="mb-6">
                    {debugData.status === 'loading' && (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 px-3 py-1 text-sm flex items-center gap-2">
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing Analysis...
                      </Badge>
                    )}
                    {debugData.status === 'success' && (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800 px-3 py-1 text-sm flex items-center gap-2">
                        <CheckCircleIcon className="h-4 w-4" />
                        Analysis Complete
                      </Badge>
                    )}
                    {debugData.status === 'error' && (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800 px-3 py-1 text-sm flex items-center gap-2">
                        <ExclamationCircleIcon className="h-4 w-4" />
                        Analysis Failed
                      </Badge>
                    )}
                  </div>

                  {/* Model selection and cost estimation */}
                  {debugData.status === 'loading' && (
                    <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-100 dark:border-blue-900">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Claude Model</h4>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <InfoIcon className="h-4 w-4 text-gray-400" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>{currentModel.description}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <Select value={selectedModel} onValueChange={handleModelChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a model" />
                          </SelectTrigger>
                          <SelectContent>
                            {CLAUDE_MODELS.map(model => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {currentModel.contextWindow.toLocaleString()} token context window
                        </p>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Estimated Cost</h4>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <InfoIcon className="h-4 w-4 text-gray-400" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>This is an estimate based on approximate token counts. Actual costs may vary.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-md p-3 border border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 dark:text-gray-400">Input:</span>
                            <span className="font-medium">${costEstimate.inputCost.toFixed(4)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm mt-1">
                            <span className="text-gray-600 dark:text-gray-400">Output:</span>
                            <span className="font-medium">${costEstimate.outputCost.toFixed(4)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <span className="font-medium">Total:</span>
                            <span className="font-bold text-blue-600 dark:text-blue-400">${costEstimate.totalCost.toFixed(4)}</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          <CalculatorIcon className="h-3 w-3" />
                          Based on {debugData.transcriptLength?.toLocaleString() || 0} chars and {debugData.commentCount || 0} comments
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Video metadata */}
                  <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-6 p-5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-800">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Video ID</p>
                      <p className="font-mono text-sm text-gray-900 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{debugData.videoId}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Title</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-200">{debugData.videoTitle || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Transcript Length</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-200">
                        <span className="text-lg font-semibold">{debugData.transcriptLength?.toLocaleString() || 'N/A'}</span> characters
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Comments</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-200">
                        <span className="text-lg font-semibold">{debugData.commentCount?.toLocaleString() || 'N/A'}</span> comments
                      </p>
                    </div>
                  </div>

                  {/* Tabs for different sections */}
                  <Tabs defaultValue="prompts" className="mt-6">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="prompts">Prompts</TabsTrigger>
                      <TabsTrigger value="results">Analysis Results</TabsTrigger>
                    </TabsList>

                    {/* Prompts Tab */}
                    <TabsContent value="prompts" className="space-y-6">
                      {/* System Prompt */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">System Prompt</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(debugData.systemPrompt || '')}
                            className="h-8 px-2"
                          >
                            <ClipboardIcon className="h-4 w-4" />
                          </Button>
                        </div>
                        <pre className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm overflow-auto max-h-[300px]">
                          <code className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                            {debugData.systemPrompt}
                          </code>
                        </pre>
                      </div>

                      {/* User Prompt */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">User Prompt</h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(debugData.userPrompt || '')}
                            className="h-8 px-2"
                          >
                            <ClipboardIcon className="h-4 w-4" />
                          </Button>
                        </div>
                        <pre className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm overflow-auto max-h-[300px]">
                          <code className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                            {debugData.userPrompt}
                          </code>
                        </pre>
                      </div>
                    </TabsContent>

                    {/* Analysis Results Tab */}
                    <TabsContent value="results">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Analysis Results</h4>
                          <div className="flex items-center gap-2">
                            {debugData.reasoning && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={toggleReasoning}
                                className="h-8 px-2"
                              >
                                {showReasoning ? 'Hide Reasoning' : 'Show Reasoning'}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(JSON.stringify(debugData.analysisResults, null, 2) || '')}
                              className="h-8 px-2"
                            >
                              <ClipboardIcon className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        {/* Show reasoning if available */}
                        {showReasoning && debugData.reasoning && (
                          <div className="mb-4">
                            <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Model Reasoning Process</h5>
                            <pre className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm overflow-auto max-h-[300px]">
                              <code className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                                {debugData.reasoning}
                              </code>
                            </pre>
                          </div>
                        )}
                        
                        <pre className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm overflow-auto max-h-[500px]">
                          <code className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                            {JSON.stringify(debugData.analysisResults, null, 2)}
                          </code>
                        </pre>
                      </div>
                    </TabsContent>
                  </Tabs>

                  {/* Video Info */}
                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Video Info</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Video ID:</span>
                          <span className="font-mono">{debugData.videoId}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Title:</span>
                          <span>{debugData.videoTitle}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Analysis Stats</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Transcript Length:</span>
                          <span>{debugData.transcriptLength?.toLocaleString()} characters</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Comments:</span>
                          <span>{debugData.commentCount?.toLocaleString()} comments</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Error Display */}
                  {debugData.error && (
                    <div className="mt-6">
                      <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4">
                        <div className="flex">
                          <ExclamationCircleIcon className="h-5 w-5 text-red-400 dark:text-red-500" aria-hidden="true" />
                          <div className="ml-3">
                            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
                            <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                              <p>{debugData.error}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-8 flex justify-end gap-3">
                    <Button variant="outline" onClick={onClose}>
                      Close
                    </Button>
                    {debugData.status === 'loading' ? (
                      <Button disabled>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing...
                      </Button>
                    ) : (
                      <Button onClick={() => onStartAnalysis?.(selectedModel)}>
                        {debugData.status === 'success' ? 'Re-analyze' : 'Start Analysis'} with {currentModel.name}
                      </Button>
                    )}
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
} 