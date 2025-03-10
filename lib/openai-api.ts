"use client"

import { toast } from "@/components/ui/use-toast";
import OpenAI from 'openai';

// Define the structure of an AI analysis result
export interface AIAnalysisResult {
  summary: string;
  keyPoints: string[];
  contentStructure: string;
  audienceInsights: string;
  suggestedImprovements: string;
  rawResponse?: string;
}

/**
 * Analyzes YouTube video transcripts using OpenAI API
 * 
 * @param content - The formatted transcript content to analyze
 * @returns Promise with analysis results
 */
export async function analyzeVideoContent(content: string): Promise<AIAnalysisResult> {
  console.log("🧠 analyzeVideoContent called with content length:", content.length);
  
  try {
    const apiKey = getOpenAIApiKey();
    console.log("🔑 API Key status:", apiKey ? "Found" : "Missing");
    console.log("🔑 API Key source:", apiKey ? (apiKey.startsWith("sk-") ? "Valid format" : "Invalid format") : "Not found");
    
    if (!apiKey) {
      // More detailed error message
      const errorMessage = "OpenAI API key is not configured. Please set up your API key in Settings.";
      console.error("❌ " + errorMessage);
      
      toast({
        title: "API Key Missing",
        description: "OpenAI API key is not configured. Please go to API Settings to add your key.",
        variant: "destructive",
      });
      
      throw new Error(errorMessage);
    }
    
    // Truncate content if it's too long (OpenAI has token limits)
    const maxContentLength = 15000; // Approximate limit to stay within token constraints
    const truncatedContent = content.length > maxContentLength 
      ? content.substring(0, maxContentLength) + "... [Content truncated due to length]"
      : content;
    
    console.log(`📝 Content ${content.length > maxContentLength ? 'truncated' : 'prepared'} for analysis, length: ${truncatedContent.length}`);
    
    // Create the analysis prompt
    const prompt = `
    Analyze the following YouTube video transcript:

    ${truncatedContent}
    
    Provide a comprehensive analysis with the following sections:
    1. Summary: A concise summary of the content (2-3 sentences)
    2. Key Points: The 3-5 most important points from the content
    3. Content Structure: How the content is organized
    4. Audience Insights: The likely target audience and their potential interests
    5. Suggested Improvements: Ways to enhance the content or presentation
    `;
    
    console.log("🔄 Preparing API request to OpenAI...");
    
    const requestBody = {
      model: "gpt-3.5-turbo", // or "gpt-4" for more advanced analysis
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that analyzes YouTube video transcripts to provide insights for content creators."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.7
    };
    
    console.log("📡 Sending request to OpenAI API...");
    
    // Call OpenAI API
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log("📡 Response status:", response.status, response.statusText);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error("❌ OpenAI API error:", errorData);
        throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
      }
      
      const data = await response.json();
      console.log("✅ OpenAI API response received");
      
      const analysisText = data.choices[0]?.message?.content;
      
      if (!analysisText) {
        console.error("❌ No content in OpenAI response");
        throw new Error("No analysis content received from OpenAI");
      }
      
      console.log("📝 Raw analysis text received (length):", analysisText.length);
      
      // Parse the response into structured sections
      // This is a simple parser that assumes each section starts with its name
      const summary = extractSection(analysisText, "Summary");
      const keyPoints = extractListItems(extractSection(analysisText, "Key Points"));
      const contentStructure = extractSection(analysisText, "Content Structure");
      const audienceInsights = extractSection(analysisText, "Audience Insights");
      const suggestedImprovements = extractSection(analysisText, "Suggested Improvements");
      
      console.log("✅ Analysis parsed successfully");
      
      return {
        summary,
        keyPoints,
        contentStructure,
        audienceInsights,
        suggestedImprovements,
        rawResponse: analysisText
      };
    } catch (fetchError) {
      console.error("❌ Fetch error:", fetchError);
      throw fetchError;
    }
  } catch (error) {
    console.error("❌ OpenAI analysis error:", error);
    toast({
      title: "AI Analysis Failed",
      description: error instanceof Error ? error.message : "Unknown error occurred",
      variant: "destructive",
    });
    
    // Return empty results on error
    return {
      summary: "Analysis failed. Please try again.",
      keyPoints: [],
      contentStructure: "",
      audienceInsights: "",
      suggestedImprovements: "",
    };
  }
}

/**
 * Helper function to extract a section from the analysis text
 */
function extractSection(text: string, sectionName: string): string {
  const sectionPattern = new RegExp(`${sectionName}:?([^#]+)`, 'i');
  const match = text.match(sectionPattern);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // Try alternative format (numbered sections)
  const numberedPattern = new RegExp(`\\d+\\.\\s*${sectionName}:?([^#]+)`, 'i');
  const numberedMatch = text.match(numberedPattern);
  
  if (numberedMatch && numberedMatch[1]) {
    return numberedMatch[1].trim();
  }
  
  return `No ${sectionName.toLowerCase()} provided`;
}

/**
 * Helper function to extract list items from a section
 */
function extractListItems(text: string): string[] {
  // Look for numbered list items (1., 2., etc.)
  const numberedItems = text.match(/\d+\.\s+[^\d\n]+/g);
  if (numberedItems && numberedItems.length > 0) {
    return numberedItems.map(item => item.replace(/^\d+\.\s+/, '').trim());
  }
  
  // Look for bulleted list items (-, *, etc.)
  const bulletedItems = text.match(/[-*•]\s+[^-*•\n]+/g);
  if (bulletedItems && bulletedItems.length > 0) {
    return bulletedItems.map(item => item.replace(/^[-*•]\s+/, '').trim());
  }
  
  // If no list format is detected, just split by newlines
  return text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

/**
 * Gets the OpenAI API key from various sources
 */
function getOpenAIApiKey(): string | null {
  // Try localStorage first (client-side only)
  if (typeof window !== 'undefined') {
    const localStorageKey = localStorage.getItem('OPENAI_API_KEY');
    if (localStorageKey) {
      return localStorageKey;
    }
  }
  
  // Then try environment variables - check both naming conventions
  if (process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
    return process.env.NEXT_PUBLIC_OPENAI_API_KEY;
  }
  
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  
  return null;
}

// Removing the embedding-related functions from here
// They will be moved to a separate server-compatible file

// Keep all client-side specific functionality that needs toast or browser APIs 