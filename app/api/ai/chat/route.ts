export const runtime = 'edge';
export const preferredRegion = 'auto';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { Anthropic } from '@anthropic-ai/sdk';
import { getSupabaseClient } from '@/lib/supabase-client';
import { createEmbeddings } from '@/lib/server/openai-embeddings';
import { hybridSearchVideoContent } from '@/lib/vector-db-service';
import { 
  getOpenAIApiKey, 
  getAnthropicApiKey, 
  isPgvectorEnabled 
} from '@/lib/env-config';
import { analyzeRelationships } from '@/lib/relationship-analyzer';
import { 
  estimateTokenCount, 
  selectChunksWithinBudget, 
  formatChunksAsContext,
  truncateToTokenBudget 
} from '@/lib/token-counter';

// Model pricing per 1M input tokens
// Last verified with Anthropic docs: August 2024
const MODEL_PRICING = {
  'claude-3-opus-20240229': {
    input: 15, // $15 per 1M input tokens
    output: 75, // $75 per 1M output tokens
    name: 'Claude 3 Opus',
    description: 'Most powerful, slower, higher cost'
  },
  'claude-3-sonnet-20240229': {
    input: 3, // $3 per 1M input tokens
    output: 15, // $15 per 1M output tokens
    name: 'Claude 3 Sonnet',
    description: 'Balanced power and cost'
  },
  'claude-3-5-sonnet-20240620': {
    input: 3, // $3 per 1M input tokens
    output: 15, // $15 per 1M output tokens
    name: 'Claude 3.5 Sonnet',
    description: 'Improved performance over 3.0 Sonnet'
  },
  'claude-3-haiku-20240307': {
    input: 0.25, // $0.25 per 1M input tokens
    output: 1.25, // $1.25 per 1M output tokens
    name: 'Claude 3 Haiku',
    description: 'Fastest, lowest cost'
  }
};

// Default model - Claude 3.5 Sonnet is currently Anthropic's most capable model
const DEFAULT_MODEL = 'claude-3-5-sonnet-20240620';
// Set a higher default token limit for more comprehensive responses
const DEFAULT_MAX_TOKENS = 4000; // Close to API maximum while leaving some buffer

interface ChatRequest {
  message: string;
  sources: {
    youtubeVideos: boolean;
    researchDocs: boolean;
    currentScript: boolean;
  };
  videoIds?: string[];
  conversationId?: string;
  previousMessages?: Message[];
  model?: string;
  maxTokens?: number;
  userId?: string;
  returnDebugInfo?: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface SourceInfo {
  type: 'youtube' | 'research' | 'script';
  id: string;
  title: string;
  timestamp?: number;
}

async function getTotalChunkCount(client: any): Promise<number> {
  try {
    const { count, error } = await client
      .from('chunks')
      .select('*', { count: 'exact', head: true });
      
    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error("Error getting chunk count:", error);
    return 0;
  }
}

function getVideoTitle(videoId: string): string | null {
  // This is a placeholder - in a real implementation, you'd look up the title
  // from your database or cache
  return videoId;
}

/**
 * RAG-powered chat API endpoint that retrieves relevant context 
 * from vector database and uses Claude to generate responses
 * 
 * POST /api/ai/chat
 */
export async function POST(request: Request) {
  const supabase = getSupabaseClient();
  try {
    // Check if vector database is enabled
    if (!isPgvectorEnabled()) {
      return NextResponse.json(
        { error: 'Vector database functionality is disabled' },
        { status: 400 }
      );
    }
    
    // Parse request body
    const { 
      message, 
      sources, 
      videoIds, 
      conversationId, 
      previousMessages,
      model = DEFAULT_MODEL,
      maxTokens = DEFAULT_MAX_TOKENS,
      userId = 'system',
      returnDebugInfo = false
    } = await request.json() as ChatRequest;
    
    // Validate required parameters
    if (!message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }
    
    // Get API keys
    const openaiApiKey = getOpenAIApiKey();
    const anthropicApiKey = getAnthropicApiKey();
    
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }
    
    if (!anthropicApiKey) {
      return NextResponse.json(
        { error: 'Anthropic API key not configured' },
        { status: 500 }
      );
    }
    
    console.log(`🔍 RAG Chat API: Processing message: "${message.substring(0, 50)}..."`);
    
    // Step 1: Generate embedding for the user message
    const embeddings = await createEmbeddings([message], openaiApiKey);
    if (!embeddings || embeddings.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate query embedding' },
        { status: 500 }
      );
    }
    
    // Debug information
    const debugInfo: any = {
      searchResults: [],
      error: null,
      systemPrompt: null,
      relationships: null
    };
    
    // Step 2: Retrieve relevant context from vector database
    let relevantContext = '';
    const contextSources: SourceInfo[] = [];
    let relationshipAnalysis = null;
    
    if (sources.youtubeVideos) {
      try {
        // Use hybrid search to get the best results
        const results = await hybridSearchVideoContent(message, embeddings[0], {
          limit: 30, // Increased from 12 to 30 to get more potential matches
          threshold: 0.68, // Maintains higher threshold for relevance
          userId: userId || 'system'
        });
        
        console.log(`🔍 Hybrid search results: ${results.length} matches found`);
        
        // Log the top results for debugging
        results.slice(0, 5).forEach((result, index) => {
          console.log(`  Result ${index + 1}: VideoID=${result.videoId}, Similarity=${result.similarity.toFixed(4)}`);
        });
        
        // Store results for debugging
        if (returnDebugInfo) {
          debugInfo.searchResults = results;
        }
        
        if (results.length > 0) {
          // Analyze relationships between content
          relationshipAnalysis = analyzeRelationships(results);
          if (returnDebugInfo) {
            debugInfo.relationships = relationshipAnalysis;
          }
          
          // Log relationship analysis for debugging
          if (relationshipAnalysis && relationshipAnalysis.crossVideoThemes.length > 0) {
            console.log(`🔍 Found ${relationshipAnalysis.crossVideoThemes.length} cross-video themes:`);
            relationshipAnalysis.crossVideoThemes.slice(0, 5).forEach((theme, i) => {
              console.log(`  Theme ${i+1}: ${theme.name} - Videos: ${theme.videos.length}, Confidence: ${theme.confidence.toFixed(2)}`);
            });
          } else {
            console.log(`⚠️ No cross-video themes detected in relationship analysis`);
          }
          
          // TOKEN BUDGET MANAGEMENT
          // Higher token budget for more comprehensive context
          const MAX_CONTEXT_TOKENS = 4000;
          
          // Select chunks that fit within our token budget
          const selectedChunks = selectChunksWithinBudget(results, MAX_CONTEXT_TOKENS);
          
          console.log(`✅ Using ${selectedChunks.length} of ${results.length} chunks (within ${MAX_CONTEXT_TOKENS} token budget)`);
          console.log(`🎞️ Content from ${new Set(selectedChunks.map(c => c.videoId)).size} unique videos`);
          
          // Format the chunks into context text
          relevantContext = formatChunksAsContext(selectedChunks, true);
          
          // Track which videos we're using
          selectedChunks.forEach(chunk => {
            if (chunk.videoId && !contextSources.some(s => s.id === chunk.videoId)) {
              contextSources.push({
                type: 'youtube',
                id: chunk.videoId,
                title: chunk.metadata?.title || chunk.videoId,
                timestamp: chunk.startTime
              });
            }
          });
        } else {
          // This shouldn't happen anymore with our hybrid approach
          console.log(`⚠️ Could not retrieve any content from database`);
        }
      } catch (error) {
        console.error("🚨 Error searching video content:", error);
        if (returnDebugInfo) {
          debugInfo.error = error instanceof Error ? error.message : String(error);
        }
      }
    }
    
    // Will add research docs and current script in future phases
    
    // Step 3: Create the full prompt for Claude
    const systemPrompt = `You are a scriptwriting assistant focused on finding relationships between topics in the user's YouTube video database using the Skyscraper Technique.

GOAL: Help the user discover connections between their content to create more comprehensive "skyscraper" content that builds on their existing videos.

DATABASE ACCESS: You have access to a database containing ${await getTotalChunkCount(supabase)} chunks from the user's YouTube videos including transcripts, descriptions, and comments.

${relevantContext ? `Below is the most semantically relevant content from the user's videos based on their query. I've included as many relevant chunks as possible to maximize content connections:` : "I couldn't find closely related content for this specific query."}

${relevantContext}

${relationshipAnalysis && relationshipAnalysis.crossVideoThemes.length > 0 ? 
  `CONTENT RELATIONSHIPS:\nI identified the following themes that appear across multiple videos:\n${
    relationshipAnalysis.crossVideoThemes.map((theme, i) => 
      `${i+1}. "${theme.name}" - ${theme.description} (Confidence: ${(theme.confidence*100).toFixed(0)}%)`
    ).join('\n')
  }` : ''}

IMPORTANT INSTRUCTIONS:
1. ALWAYS provide concrete answers based on the content provided above
2. NEVER say you cannot answer or need more data - work with what you have
3. Draw insights and conclusions from the chunks provided, not theoretical analysis
4. If you see a topic mentioned across multiple chunks, consider it a recurring subtopic
5. If a topic appears frequently but is not the main focus of any video, highlight it as an opportunity
6. Identify specific relationships between different videos
7. Directly quote relevant content to support your observations

When referring to specific YouTube videos, use the format: [Video Title].

Your answer should be concise and actionable. Start with direct observations from the content provided, then offer specific insights about subtopics that appear across videos but haven't been fully explored.`;

    // For debugging
    if (returnDebugInfo) {
      debugInfo.systemPrompt = systemPrompt;
    }
    
    // Estimate token usage for pricing
    const systemTokens = estimateTokenCount(systemPrompt);
    const messageTokens = estimateTokenCount(message);
    const previousTokens = previousMessages ? 
      previousMessages.reduce((sum, msg) => sum + estimateTokenCount(msg.content), 0) : 0;
    
    const totalInputTokens = systemTokens + messageTokens + previousTokens;
    const estimatedInputCost = (totalInputTokens / 1000000) * MODEL_PRICING[model as keyof typeof MODEL_PRICING].input;
    const maxOutputCost = (maxTokens / 1000000) * MODEL_PRICING[model as keyof typeof MODEL_PRICING].output;
    
    console.log(`🧮 Estimated costs - Input: $${estimatedInputCost.toFixed(6)}, Max Output: $${maxOutputCost.toFixed(6)}`);

    // Step 4: Send the prompt to Claude and get a response
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
    });
    
    // Format previous messages if provided
    const messages: Anthropic.MessageParam[] = previousMessages ? 
      previousMessages.map(msg => ({
        role: msg.role,
        content: msg.content
      })) : [];
    
    // Add the current message
    messages.push({
      role: 'user',
      content: message
    });
    
    // Call Claude API with selected model
    console.log(`🤖 Using model: ${model} with max tokens: ${maxTokens}`);
    const response = await anthropic.messages.create({
      model: model as Anthropic.MessageCreateParams['model'],
      system: systemPrompt,
      messages,
      max_tokens: maxTokens
    });
    
    // Get the response text content
    let responseText = '';
    if (response.content[0].type === 'text') {
      responseText = response.content[0].text;
    }
    
    // Calculate actual usage and costs
    const actualInputTokens = response.usage?.input_tokens || totalInputTokens;
    const actualOutputTokens = response.usage?.output_tokens || estimateTokenCount(responseText);
    
    const actualInputCost = (actualInputTokens / 1000000) * MODEL_PRICING[model as keyof typeof MODEL_PRICING].input;
    const actualOutputCost = (actualOutputTokens / 1000000) * MODEL_PRICING[model as keyof typeof MODEL_PRICING].output;
    const totalCost = actualInputCost + actualOutputCost;
    
    console.log(`💰 Actual costs - Input: $${actualInputCost.toFixed(6)}, Output: $${actualOutputCost.toFixed(6)}, Total: $${totalCost.toFixed(6)}`);
    
    // Step 5: Return the response with metadata and debug info if requested
    return NextResponse.json({
      response: responseText,
      sources: contextSources,
      conversationId: conversationId || generateConversationId(),
      usage: {
        model: model,
        modelName: MODEL_PRICING[model as keyof typeof MODEL_PRICING].name,
        inputTokens: actualInputTokens,
        outputTokens: actualOutputTokens,
        inputCost: actualInputCost,
        outputCost: actualOutputCost,
        totalCost: totalCost
      },
      ...(returnDebugInfo && { debugInfo })
    });
  } catch (error) {
    console.error('🚨 Error in RAG chat endpoint:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}

function formatTimestamp(seconds?: number): string {
  if (seconds === undefined || seconds === null) return 'N/A';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function generateConversationId(): string {
  // Simple UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
} 