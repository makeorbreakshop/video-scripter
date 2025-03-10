"use client"

import React from 'react';
import { AIAnalysisResult } from '@/lib/openai-api';
import { Button } from '@/components/ui/button';
import { X, Download, Copy, FileText } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";

interface VideoAnalysisResultProps {
  analysis: AIAnalysisResult;
  onClose: () => void;
  onSaveAsDocument?: (content: string) => void;
}

export function VideoAnalysisResult({ 
  analysis, 
  onClose,
  onSaveAsDocument 
}: VideoAnalysisResultProps) {
  const { toast } = useToast();
  
  const copyToClipboard = () => {
    // Create formatted text for clipboard
    const formattedText = `
# Video Analysis

## Summary
${analysis.summary}

## Key Points
${analysis.keyPoints.map(point => `- ${point}`).join('\n')}

## Content Structure
${analysis.contentStructure}

## Audience Insights
${analysis.audienceInsights}

## Suggested Improvements
${analysis.suggestedImprovements}
    `.trim();
    
    navigator.clipboard.writeText(formattedText)
      .then(() => {
        toast({
          title: "Copied to Clipboard",
          description: "Analysis has been copied to clipboard",
        });
      })
      .catch(err => {
        console.error('Failed to copy:', err);
        toast({
          title: "Copy Failed",
          description: "Could not copy to clipboard",
          variant: "destructive",
        });
      });
  };
  
  const handleSaveAsDocument = () => {
    if (!onSaveAsDocument) return;
    
    // Create HTML content for document
    const htmlContent = `
      <h1>Video Analysis</h1>
      
      <h2>Summary</h2>
      <p>${analysis.summary}</p>
      
      <h2>Key Points</h2>
      <ul>
        ${analysis.keyPoints.map(point => `<li>${point}</li>`).join('')}
      </ul>
      
      <h2>Content Structure</h2>
      <p>${analysis.contentStructure}</p>
      
      <h2>Audience Insights</h2>
      <p>${analysis.audienceInsights}</p>
      
      <h2>Suggested Improvements</h2>
      <p>${analysis.suggestedImprovements}</p>
    `;
    
    onSaveAsDocument(htmlContent);
  };
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl border border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between bg-gray-800 px-4 py-3 border-b border-gray-700">
          <h3 className="text-lg font-medium text-gray-100">AI Video Analysis</h3>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Summary Section */}
          <div>
            <h4 className="text-md font-semibold text-blue-400 mb-2">Summary</h4>
            <p className="text-gray-300">{analysis.summary}</p>
          </div>
          
          {/* Key Points Section */}
          <div>
            <h4 className="text-md font-semibold text-blue-400 mb-2">Key Points</h4>
            <ul className="list-disc pl-5 space-y-1">
              {analysis.keyPoints.map((point, index) => (
                <li key={index} className="text-gray-300">{point}</li>
              ))}
            </ul>
          </div>
          
          {/* Content Structure Section */}
          <div>
            <h4 className="text-md font-semibold text-blue-400 mb-2">Content Structure</h4>
            <p className="text-gray-300 whitespace-pre-line">{analysis.contentStructure}</p>
          </div>
          
          {/* Audience Insights Section */}
          <div>
            <h4 className="text-md font-semibold text-blue-400 mb-2">Audience Insights</h4>
            <p className="text-gray-300 whitespace-pre-line">{analysis.audienceInsights}</p>
          </div>
          
          {/* Suggested Improvements Section */}
          <div>
            <h4 className="text-md font-semibold text-blue-400 mb-2">Suggested Improvements</h4>
            <p className="text-gray-300 whitespace-pre-line">{analysis.suggestedImprovements}</p>
          </div>
        </div>
        
        {/* Footer with actions */}
        <div className="px-4 py-3 bg-gray-800 border-t border-gray-700 flex items-center justify-end space-x-2">
          <Button 
            variant="outline" 
            onClick={copyToClipboard}
            className="h-9 text-sm flex items-center space-x-1.5"
          >
            <Copy className="h-4 w-4 mr-1" />
            <span>Copy to Clipboard</span>
          </Button>
          
          <Button 
            variant="outline" 
            onClick={handleSaveAsDocument}
            className="h-9 text-sm flex items-center space-x-1.5"
            disabled={!onSaveAsDocument}
          >
            <FileText className="h-4 w-4 mr-1" />
            <span>Save as Document</span>
          </Button>
        </div>
      </div>
    </div>
  );
} 