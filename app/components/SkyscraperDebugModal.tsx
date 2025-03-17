import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { XMarkIcon, ClipboardIcon, CheckCircleIcon, ExclamationCircleIcon, CalculatorIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline'
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { InfoIcon } from "lucide-react"
import { Label } from "@/components/ui/label"
import { CLAUDE_MODELS } from "@/app/constants/claude-models"
import { useChat } from 'ai/react'
import { toast } from "@/components/ui/use-toast"

// Helper function to estimate token count (rough approximation)
const estimateTokenCount = (text: string): number => {
  if (!text) return 0;
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
};

// Helper function to safely parse JSON even if incomplete
const safeParseJSON = (text: string) => {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    console.log('Empty or invalid text provided to safeParseJSON');
    return null;
  }
  
  // Process markdown code blocks if present
  let processedText = text;
  const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (markdownMatch && markdownMatch[1]) {
    console.log('Found markdown code block, extracting content');
    processedText = markdownMatch[1].trim();
    
    // If the extracted content seems to be valid JSON, use it directly
    if (processedText.startsWith('{') && processedText.endsWith('}')) {
      try {
        const result = JSON.parse(processedText);
        console.log('Successfully parsed markdown code block content:', 
          Object.keys(result).join(', '));
        return result;
      } catch (e) {
        // If direct parsing failed, continue with other methods
        console.log('Failed to parse markdown content directly');
      }
    }
  }
  
  // Only try to parse text that looks like JSON
  if (!processedText.trim().startsWith('{')) {
    console.log('Processed text does not appear to be JSON (no opening brace)');
    return null;
  }
  
  try {
    // First, try to parse it directly
    const result = JSON.parse(processedText);
    console.log('Successfully parsed complete JSON directly:', 
      Object.keys(result).join(', '));
    return result;
  } catch (e) {
    console.log('Direct JSON parsing failed, trying extraction methods');
    
    try {
      // If direct parsing fails, try to find a complete JSON object
      // First, look for the last complete JSON object using a more robust pattern
      const jsonPattern = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/g;
      let matches = [...processedText.matchAll(jsonPattern)];
      
      if (matches.length > 0) {
        // Get the largest match, which is likely the most complete
        let largestMatch = matches[0][0];
        let largestLength = largestMatch.length;
        
        for (const match of matches) {
          if (match[0].length > largestLength) {
            largestMatch = match[0];
            largestLength = match[0].length;
          }
        }
        
        console.log('Found JSON object with regex pattern, length:', largestLength);
        try {
          const result = JSON.parse(largestMatch);
          console.log('Successfully parsed extracted JSON:', 
            Object.keys(result).join(', '));
          return result;
        } catch (parseErr) {
          console.log('Failed to parse extracted JSON match');
        }
      }
      
      // If the robust pattern fails, try a simpler approach
      const simpleMatch = processedText.match(/\{[\s\S]*\}/);
      if (simpleMatch) {
        try {
          console.log('Found JSON with simple pattern, length:', simpleMatch[0].length);
          const result = JSON.parse(simpleMatch[0]);
          console.log('Successfully parsed simple match:', 
            Object.keys(result).join(', '));
          return result;
        } catch (parseErr) {
          console.log('Failed to parse simple match JSON');
        }
      }
      
      // Last resort: try to find the largest balanced braces block
      let maxStart = -1;
      let maxEnd = -1;
      let maxLength = 0;
      
      for (let i = 0; i < processedText.length; i++) {
        if (processedText[i] === '{') {
          // Found an opening brace, try to find the matching closing brace
          let depth = 1;
          for (let j = i + 1; j < processedText.length; j++) {
            if (processedText[j] === '{') depth++;
            else if (processedText[j] === '}') depth--;
            
            if (depth === 0) {
              // Found a balanced block
              const length = j - i + 1;
              if (length > maxLength) {
                maxStart = i;
                maxEnd = j;
                maxLength = length;
              }
              break;
            }
          }
        }
      }
      
      if (maxStart >= 0 && maxLength > 10) { // Minimum size to consider valid
        try {
          const jsonCandidate = processedText.substring(maxStart, maxEnd + 1);
          console.log('Found balanced JSON with manual parsing, length:', jsonCandidate.length);
          const result = JSON.parse(jsonCandidate);
          console.log('Successfully parsed manual balanced match:', 
            Object.keys(result).join(', '));
          return result;
        } catch (parseErr) {
          console.log('Failed to parse manually balanced JSON');
        }
      }
    } catch (e2) {
      console.log('All JSON extraction methods failed:', e2);
    }
    
    console.log('Could not extract valid JSON after trying all methods');
    return null;
  }
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
  onStartStreamAnalysis?: (modelId?: string) => void
  parsedStreamData?: any
  setParsedStreamData?: React.Dispatch<React.SetStateAction<any>>
}

// Helper function to combine class names
function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ')
}

const SkyscraperDebugModal = forwardRef<{streamedText: string}, DebugModalProps>(function SkyscraperDebugModal(props, ref) {
  const {
    isOpen, 
    onClose, 
    debugData, 
    onSaveAnalysis, 
    onStartAnalysis,
    onStartStreamAnalysis,
    parsedStreamData: externalParsedStreamData,
    setParsedStreamData: setExternalParsedStreamData
  } = props;
  
  const [selectedModel, setSelectedModel] = useState(CLAUDE_MODELS[0].id);
  const [costEstimate, setCostEstimate] = useState({ inputCost: 0, outputCost: 0, totalCost: 0 });
  const [showReasoning, setShowReasoning] = useState(false);
  const [activeTab, setActiveTab] = useState("prompts");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [streamedReasoning, setStreamedReasoning] = useState<string[]>([]);
  const [parsedStreamData, setParsedStreamData] = useState<any>(null);
  const [isSaved, setIsSaved] = useState(false);
  
  // Expose streamedText through ref
  useImperativeHandle(ref, () => ({
    streamedText
  }));
  
  // Update both internal and external state when parsed data changes
  const updateParsedData = (data: any) => {
    setParsedStreamData(data);
    if (setExternalParsedStreamData) {
      setExternalParsedStreamData(data);
    }
  };
  
  // Set up chat for streaming
  const { messages, setMessages, append, isLoading } = useChat({
    api: "/api/skyscraper/analyze-stream",
    body: {
      videoId: debugData.videoId,
      userId: "00000000-0000-0000-0000-000000000000", // Default user ID for demonstration
    },
    onResponse: (response) => {
      setIsStreaming(true);
      setActiveTab("results");
    },
    onFinish: () => {
      setIsStreaming(false);
    },
    sendExtraMessageFields: true
  });

  // Listen for streaming message updates
  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      
      // Extract text and reasoning from the message
      let textContent = "";
      let reasoningContent: string[] = [];
      
      if (lastMessage.role === 'assistant') {
        lastMessage.parts?.forEach((part) => {
          if (part.type === 'text') {
            textContent = part.text;
            setStreamedText(part.text);
            
            // Check if the message contains markdown code block markers
            if (textContent.includes('```json') || (textContent.includes('```') && textContent.includes('{'))) {
              console.log('Detected markdown code block in streamed text');
              
              // Extract the JSON from the markdown code block
              const markdownMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/);
              if (markdownMatch && markdownMatch[1]) {
                const jsonContent = markdownMatch[1].trim();
                console.log('Extracted content from markdown block, attempting to parse');
                
                try {
                  const parsed = JSON.parse(jsonContent);
                  console.log('Successfully parsed markdown code block:', 
                    Object.keys(parsed).join(', '));
                  updateParsedData(parsed);
                } catch (e) {
                  console.log('Failed to parse extracted markdown content:', e);
                  
                  // Fall back to our more robust parsing methods
                  const fallbackParsed = safeParseJSON(textContent);
                  if (fallbackParsed) {
                    updateParsedData(fallbackParsed);
                  }
                }
              } else {
                // If we can't extract with the regex, fallback to safe parsing
                const fallbackParsed = safeParseJSON(textContent);
                if (fallbackParsed) {
                  updateParsedData(fallbackParsed);
                }
              }
            } 
            // Only try regular JSON parsing if the text contains JSON-like patterns
            else if (textContent && textContent.includes('{') && textContent.includes('}')) {
              console.log('Attempting to parse JSON from streamed text...');
              
              // Try to parse JSON from the streamed text
              const parsed = safeParseJSON(textContent);
              if (parsed) {
                updateParsedData(parsed);
              }
            }
          }
          
          // Handle reasoning parts if they exist
          // Check first if it's a reasoning part
          if (part.type === 'reasoning') {
            // @ts-ignore - Handle reasoning part based on its type
            if (part.details && Array.isArray(part.details)) {
              // @ts-ignore - Extract text from reasoning details
              part.details.forEach(detail => {
                if (detail.type === 'text' && detail.text) {
                  reasoningContent.push(detail.text);
                }
              });
              
              if (reasoningContent.length > 0) {
                setStreamedReasoning(prev => [...prev, ...reasoningContent]);
              }
            }
          }
        });
      }
    }
  }, [messages]);
  
  // Try one more parse when streaming ends
  useEffect(() => {
    // When streaming ends, make one final attempt to parse the text
    if (!isStreaming && streamedText && (!parsedStreamData || Object.keys(parsedStreamData).length === 0)) {
      console.log('Streaming ended, making final parse attempt...');
      
      // First check specifically for markdown code blocks
      if (streamedText.includes('```json') || (streamedText.includes('```') && streamedText.includes('{'))) {
        console.log('Detected markdown code block in final parse');
        
        // Extract the JSON from the markdown code block
        const markdownMatch = streamedText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (markdownMatch && markdownMatch[1]) {
          const jsonContent = markdownMatch[1].trim();
          console.log('Extracted content from markdown block, attempting final parse');
          
          try {
            const parsed = JSON.parse(jsonContent);
            console.log('Successfully parsed markdown in final attempt:', 
              Object.keys(parsed).join(', '));
            updateParsedData(parsed);
            return; // Exit early if successful
          } catch (e) {
            console.log('Failed to parse markdown in final attempt:', e);
            // Continue to fallback methods
          }
        }
      }
      
      // Fall back to regular parsing if markdown extraction failed
      const finalParsed = safeParseJSON(streamedText);
      if (finalParsed) {
        console.log('Final parse was successful, updating data');
        updateParsedData(finalParsed);
      } else {
        console.log('Final parse attempt failed, no valid JSON found');
      }
    }
  }, [isStreaming, streamedText]);
  
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
  
  // Start streaming analysis
  const handleStartStreaming = () => {
    // Clear previous streaming data
    setStreamedText("");
    setStreamedReasoning([]);
    updateParsedData(null);
    setMessages([]);
    setIsSaved(false); // Reset saved state
    
    // Add the system and user prompts to messages
    append({
      role: "user",
      content: debugData.userPrompt || "Please analyze this video content.",
      id: Date.now().toString(),
    });
    
    if (onStartStreamAnalysis) {
      onStartStreamAnalysis(selectedModel);
    }
  };

  // Auto-save when streaming completes
  useEffect(() => {
    if (!isStreaming && streamedText && streamedText.length > 0) {
      // Wait a moment to ensure all data is processed
      const timer = setTimeout(() => {
        console.log('Auto-save timer triggered. Stream data status:', {
          hasStreamText: !!streamedText,
          streamTextLength: streamedText?.length || 0,
          hasParsedData: !!parsedStreamData,
          parsedDataKeys: parsedStreamData ? Object.keys(parsedStreamData) : 'none'
        });
        
        // Try to extract JSON from the streamed text if not already parsed
        let extractedData = null;
        if (!parsedStreamData && streamedText) {
          // Look for JSON in markdown code blocks
          const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)```/;
          const match = streamedText.match(jsonBlockRegex);
          
          if (match && match[1]) {
            try {
              extractedData = JSON.parse(match[1].trim());
              console.log('Auto-extracted JSON from streamed text:', Object.keys(extractedData));
              
              // Update parsed data state
              if (setExternalParsedStreamData) {
                setExternalParsedStreamData(extractedData);
              }
              setParsedStreamData(extractedData);
            } catch (e) {
              console.error('Failed to parse JSON from markdown block:', e);
            }
          } else {
            // Try finding JSON object pattern
            const jsonPattern = /\{(?:[^{}]|(?:\{(?:[^{}]|(?:\{[^{}]*\}))*\}))*\}/;
            const objectMatch = streamedText.match(jsonPattern);
            
            if (objectMatch) {
              try {
                extractedData = JSON.parse(objectMatch[0]);
                console.log('Auto-extracted JSON using pattern matching:', Object.keys(extractedData));
                
                // Update parsed data state
                if (setExternalParsedStreamData) {
                  setExternalParsedStreamData(extractedData);
                }
                setParsedStreamData(extractedData);
              } catch (e) {
                console.error('Failed to parse JSON from pattern match:', e);
              }
            }
          }
          
          // If we still couldn't parse, try one more approach
          if (!extractedData) {
            try {
              // Try to find JSON content by key patterns
              if (streamedText.includes('"content_analysis"') || 
                  streamedText.includes('"audience_analysis"') || 
                  streamedText.includes('"framework_elements"')) {
                
                // Find the first opening brace
                const startIdx = streamedText.indexOf('{');
                if (startIdx !== -1) {
                  // Find balanced closing brace
                  let depth = 1;
                  let endIdx = -1;
                  for (let i = startIdx + 1; i < streamedText.length; i++) {
                    if (streamedText[i] === '{') depth++;
                    else if (streamedText[i] === '}') depth--;
                    
                    if (depth === 0) {
                      endIdx = i;
                      break;
                    }
                  }
                  
                  if (endIdx !== -1) {
                    const jsonContent = streamedText.substring(startIdx, endIdx + 1);
                    try {
                      extractedData = JSON.parse(jsonContent);
                      console.log('Successfully extracted JSON by balanced braces:', 
                        Object.keys(extractedData).join(', '));
                        
                      // Update parsed data state
                      if (setExternalParsedStreamData) {
                        setExternalParsedStreamData(extractedData);
                      }
                      setParsedStreamData(extractedData);
                    } catch (e) {
                      console.error('Failed to parse balanced braces content:', e);
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Final extraction attempt failed:', e);
            }
          }
        }
        
        // Ensure the parent component gets updated with the latest parsed data
        if (parsedStreamData && setExternalParsedStreamData) {
          console.log('Updating external state with parsed data:', Object.keys(parsedStreamData).join(', '));
          setExternalParsedStreamData(parsedStreamData);
        }
        
        if (onSaveAnalysis) {
          console.log('Streaming completed, auto-saving analysis data...');
          onSaveAnalysis();
          setIsSaved(true);
          
          // Show a toast notification or update UI to indicate auto-save
          try {
            // If you're using shadcn UI toast
            toast({
              title: "Analysis Auto-Saved",
              description: "The analysis has been automatically saved to the database.",
              duration: 3000,
            });
          } catch (e) {
            // Fallback if toast isn't directly available
            console.log('Analysis has been automatically saved');
          }
        }
      }, 5000); // Increased delay to ensure everything is processed
      
      return () => clearTimeout(timer);
    }
  }, [isStreaming, streamedText, parsedStreamData, onSaveAnalysis, setParsedStreamData, setExternalParsedStreamData]);

  // Also add a handler for the manual save button click
  const handleSaveClick = () => {
    if (onSaveAnalysis) {
      onSaveAnalysis();
      setIsSaved(true);
    }
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
                <div className="absolute right-0 top-0 pr-4 pt-4">
                  <button
                    type="button"
                    className="rounded-md bg-white dark:bg-gray-800 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    onClick={onClose}
                  >
                    <span className="sr-only">Close</span>
                    <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                  </button>
                </div>
                
                <div className="border-b border-gray-200 dark:border-gray-700">
                  <Dialog.Title className="text-lg font-semibold leading-6 text-gray-900 dark:text-gray-100 p-6">
                    Skyscraper Analysis Debug Info
                  </Dialog.Title>
                </div>
                
                <div className="p-6">
                  {/* Video Info Section */}
                  <div className="mb-6 grid grid-cols-2 gap-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Video ID</h3>
                        <p className="mt-1 text-sm font-mono text-gray-900 dark:text-gray-200">{debugData.videoId}</p>
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Title</h3>
                        <p className="mt-1 text-sm text-gray-900 dark:text-gray-200">{debugData.videoTitle}</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Transcript Length</h3>
                        <p className="mt-1 text-sm text-gray-900 dark:text-gray-200">{debugData.transcriptLength?.toLocaleString()} characters</p>
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Comments</h3>
                        <p className="mt-1 text-sm text-gray-900 dark:text-gray-200">{debugData.commentCount} comments</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Model Selection */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="model-select" className="text-sm font-medium text-gray-700 dark:text-gray-300">Claude Model</Label>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Estimated Cost: ${costEstimate.totalCost.toFixed(4)}
                      </div>
                    </div>
                    <Select
                      value={selectedModel}
                      onValueChange={handleModelChange}
                    >
                      <SelectTrigger className="w-full mt-1">
                        <SelectValue placeholder="Select Claude model" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLAUDE_MODELS.map(model => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name} (${model.inputCostPer1kTokens}/${model.outputCostPer1kTokens} per 1k tokens)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Input: ${costEstimate.inputCost.toFixed(4)} | Output: ${costEstimate.outputCost.toFixed(4)}
                    </p>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex space-x-4 mt-6">
                    <Button
                      onClick={handleStartStreaming}
                      className="flex-1"
                      variant="default"
                    >
                      Stream Analysis
                    </Button>
                    <Button
                      onClick={handleSaveClick}
                      variant={isSaved ? "outline" : "secondary"}
                      className={`flex-1 ${isSaved ? 'bg-green-900/20 hover:bg-green-900/30 text-green-500' : ''}`}
                      disabled={isStreaming || (!parsedStreamData && !debugData.analysisResults)}
                    >
                      {isStreaming 
                        ? "Streaming..."
                        : isSaved
                          ? "✓ Saved to DB"
                          : parsedStreamData 
                            ? `Save to DB (${Object.keys(parsedStreamData).length} keys)`
                            : debugData.analysisResults
                              ? `Save to DB (${Object.keys(debugData.analysisResults).length} keys)`
                              : "No Data to Save"
                      }
                    </Button>
                    
                    {/* Button explanation tooltip */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <InfoIcon className="h-5 w-5 text-gray-400 self-center" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start" className="max-w-xs">
                          <p className="text-xs">
                            This button saves the analyzed data to the database. 
                            {isStreaming 
                              ? " Wait for streaming to complete."
                              : !parsedStreamData && !debugData.analysisResults
                                ? " No valid analysis data found to save."
                                : parsedStreamData
                                  ? ` Found ${Object.keys(parsedStreamData).length} keys in parsed stream data.`
                                  : ` Found ${Object.keys(debugData.analysisResults).length} keys in analysis results.`
                            }
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  
                  {/* Tab Navigation */}
                  <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
                    <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                      <button
                        onClick={() => setActiveTab("prompts")}
                        className={classNames(
                          activeTab === "prompts"
                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300",
                          "whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm"
                        )}
                      >
                        Prompts
                      </button>
                      <button
                        onClick={() => setActiveTab("results")}
                        className={classNames(
                          activeTab === "results"
                            ? "border-blue-500 text-blue-600 dark:text-blue-400"
                            : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300",
                          "whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm"
                        )}
                      >
                        Analysis Results
                      </button>
                    </nav>
                  </div>
                  
                  {/* Tab Contents */}
                  {activeTab === "prompts" && (
                    <div className="space-y-6">
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
                    </div>
                  )}
                  
                  {activeTab === "results" && (
                    <div className="space-y-6">
                      {/* Status Indicator */}
                      <div className="flex items-center space-x-2">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Status:
                        </span>
                        <Badge
                          variant={
                            debugData.status === 'success' || !isLoading 
                              ? 'secondary' 
                              : debugData.status === 'loading' || isLoading || isStreaming
                              ? 'default'
                              : 'destructive'
                          }
                          className="px-2 py-0.5"
                        >
                          {isLoading || isStreaming
                            ? "Streaming..."
                            : debugData.status === 'success'
                            ? "Complete"
                            : debugData.status === 'error'
                            ? "Error"
                            : debugData.status}
                        </Badge>
                      </div>
                      
                      {/* Toggle for Reasoning */}
                      <div className="flex items-center space-x-2 mb-4">
                        <button
                          onClick={toggleReasoning}
                          className={`px-3 py-1 text-xs font-medium rounded-md ${
                            showReasoning
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                          }`}
                        >
                          {showReasoning ? 'Hide Reasoning' : 'Show Reasoning'}
                        </button>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <InfoIcon className="h-4 w-4 text-gray-400" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">View Claude's reasoning process</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      
                      {/* Reasoning Display */}
                      {showReasoning && (streamedReasoning.length > 0 || debugData.reasoning) && (
                        <div className="space-y-2 mb-6">
                          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Claude's Reasoning</h4>
                          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950 text-sm overflow-auto max-h-[300px] border border-amber-200 dark:border-amber-800">
                            <pre className="text-amber-800 dark:text-amber-200 whitespace-pre-wrap text-xs">
                              {streamedReasoning.length > 0 
                                ? streamedReasoning.join('\n\n')
                                : debugData.reasoning}
                            </pre>
                          </div>
                        </div>
                      )}
                      
                      {/* Error Display */}
                      {debugData.error && (
                        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950 text-sm border border-red-200 dark:border-red-900">
                          <div className="flex items-start">
                            <ExclamationCircleIcon className="h-5 w-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                            <div>
                              <h4 className="text-sm font-medium text-red-800 dark:text-red-300">Error</h4>
                              <p className="mt-1 text-sm text-red-700 dark:text-red-400">{debugData.error}</p>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Streaming Results Display */}
                      {isStreaming || streamedText ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                              {isStreaming ? "Streaming Response..." : "Streamed Response"}
                            </h4>
                            {streamedText && (
                              <Button
                                onClick={() => copyToClipboard(streamedText)}
                                variant="ghost"
                                size="sm"
                                className="h-6 hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                <DocumentDuplicateIcon className="h-4 w-4 mr-1" />
                                <span className="text-xs">Copy</span>
                              </Button>
                            )}
                          </div>
                          
                          {/* Small parsing status indicator */}
                          {streamedText && !isStreaming && (
                            <div className="flex items-center text-xs mb-2">
                              <div className={`h-2 w-2 rounded-full mr-2 ${parsedStreamData ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span className="text-gray-600 dark:text-gray-400">
                                {parsedStreamData 
                                  ? `Parsed ${Object.keys(parsedStreamData).length} keys: ${Object.keys(parsedStreamData).join(', ')}`
                                  : 'No valid JSON structure detected'
                                }
                              </span>
                            </div>
                          )}
                          
                          <div
                            className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm overflow-auto max-h-[500px]"
                          >
                            <code className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                              {streamedText || "Waiting for streaming to begin..."}
                            </code>
                          </div>
                        </div>
                      ) : (
                        // Show normal analysis results from debugData if not streaming
                        debugData.analysisResults && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Analysis Results</h4>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(JSON.stringify(debugData.analysisResults, null, 2))}
                                className="h-8 px-2"
                              >
                                <ClipboardIcon className="h-4 w-4" />
                              </Button>
                            </div>
                            <pre className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm overflow-auto max-h-[500px]">
                              <code className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                                {JSON.stringify(debugData.analysisResults, null, 2)}
                              </code>
                            </pre>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
})

export default SkyscraperDebugModal; 