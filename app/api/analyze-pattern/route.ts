/**
 * Pattern Analysis API - Extracts patterns and validates across niches
 * POST /api/analyze-pattern
 * 
 * Enhanced with Claude Sonnet 4 Extended Thinking (4k tokens) for:
 * - Superior psychological mechanism analysis
 * - Enhanced visual pattern recognition
 * - More actionable replication strategies
 * - Visible reasoning process for debugging
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import Anthropic from '@anthropic-ai/sdk';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';
import { pineconeThumbnailService } from '@/lib/pinecone-thumbnail-service';
import { generateVisualQueryEmbedding } from '@/lib/thumbnail-embeddings';
import fs from 'fs';
import path from 'path';

// Helper functions to generate queries from improved pattern format
function generateSemanticQueries(pattern: any): string[] {
  const queries: string[] = [];
  
  // Try new enhanced format first
  if (pattern.step_5_pattern_formulation?.pattern_name) {
    const patternName = pattern.step_5_pattern_formulation.pattern_name.toLowerCase();
    queries.push(`${patternName} pattern examples`);
  }
  // Fallback to old format
  else if (pattern.step_4_pattern_formulation?.pattern_name) {
    const patternName = pattern.step_4_pattern_formulation.pattern_name.toLowerCase();
    queries.push(`${patternName} pattern examples`);
  }
  
  // Try new enhanced format
  if (pattern.step_4_psychological_mechanism) {
    const psychMechanism = pattern.step_4_psychological_mechanism;
    if (psychMechanism.includes('completion bias')) queries.push('completion bias visual design');
    if (psychMechanism.includes('curiosity gap')) queries.push('curiosity gap thumbnails');
    if (psychMechanism.includes('perfectionism')) queries.push('perfectionism marketing promises');
    if (psychMechanism.includes('impossible')) queries.push('impossible transformation pattern examples');
    if (psychMechanism.includes('cognitive dissonance')) queries.push('curiosity gap thumbnails');
  }
  // Fallback to old format
  else if (pattern.step_3_psychological_mechanism) {
    const psychMechanism = pattern.step_3_psychological_mechanism;
    if (psychMechanism.includes('completion bias')) queries.push('completion bias visual design');
    if (psychMechanism.includes('curiosity gap')) queries.push('curiosity gap thumbnails');
    if (psychMechanism.includes('perfectionism')) queries.push('perfectionism marketing promises');
  }
  
  // Try new enhanced format
  if (pattern.step_5_pattern_formulation?.replication_strategy) {
    const strategy = pattern.step_5_pattern_formulation.replication_strategy;
    if (strategy.includes('simple representations')) queries.push('simple bold visual representations');
    if (strategy.includes('consumer-product')) queries.push('consumer product visual language');
    if (strategy.includes('material transformation')) queries.push('material transformation pattern examples');
  }
  // Fallback to old format
  else if (pattern.step_4_pattern_formulation?.replication_strategy) {
    const strategy = pattern.step_4_pattern_formulation.replication_strategy;
    if (strategy.includes('simple representations')) queries.push('simple bold visual representations');
    if (strategy.includes('consumer-product')) queries.push('consumer product visual language');
  }
  
  // Default fallback queries
  if (queries.length === 0) {
    queries.push('visual pattern analysis', 'thumbnail design psychology', 'content differentiation');
  }
  
  return queries.slice(0, 3); // Limit to 3 queries
}

function generateVisualQueries(pattern: any): string[] {
  const queries: string[] = [];
  
  if (pattern.step_1_visual_inventory?.colors) {
    const colors = pattern.step_1_visual_inventory.colors;
    if (colors.includes('orange') && colors.includes('green')) {
      queries.push('orange and green high contrast design');
    }
    if (colors.includes('bold') || colors.includes('high contrast')) {
      queries.push('bold high contrast visual design');
    }
  }
  
  if (pattern.step_1_visual_inventory?.composition) {
    const composition = pattern.step_1_visual_inventory.composition;
    if (composition.includes('simple') || composition.includes('clean')) {
      queries.push('simple clean visual composition');
    }
    if (composition.includes('focal point') || composition.includes('singular')) {
      queries.push('single focal point design');
    }
  }
  
  // Default fallback
  if (queries.length === 0) {
    queries.push('visual design patterns', 'thumbnail composition');
  }
  
  return queries.slice(0, 2); // Limit to 2 visual queries
}

interface AnalyzeRequest {
  video_id: string;
}

interface ExtractedPattern {
  pattern_name: string;
  pattern_description: string;
  psychological_trigger: string;
  key_elements: string[];
  visual_elements?: string[];
  thumbnail_psychology?: string;
  design_quality_score?: number;
  design_strengths?: string[];
  marketing_positioning?: string;
  competitive_advantage?: string;
  why_it_works: string;
  semantic_queries: string[];
  visual_queries?: string[];
  channel_outlier_explanation?: string;
}

interface ValidationResult {
  niche: string;
  videos: {
    title: string;
    score: number;
    views: number;
    channel: string;
    thumbnail_url?: string;
    validation_reason?: string;
    visual_match?: string;
    source?: 'title' | 'summary' | 'thumbnail';
  }[];
  avg_score: number;
  count: number;
}

// Enhanced logging utility
class PatternAnalysisLogger {
  private logs: string[] = [];
  private logFile: string = '';
  
  constructor(videoId: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logDir = '/Users/brandoncullum/video-scripter/logs/pattern-analysis';
    const dateDir = path.join(logDir, new Date().toISOString().slice(0, 10));
    
    // Ensure directory exists
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    if (!fs.existsSync(dateDir)) fs.mkdirSync(dateDir, { recursive: true });
    
    this.logFile = path.join(dateDir, `enhanced-pattern-${videoId}-${timestamp}.log`);
    this.log('='.repeat(80));
    this.log(`ENHANCED PATTERN ANALYSIS LOG - ${new Date().toISOString()}`);
    this.log(`Video ID: ${videoId}`);
    this.log('='.repeat(80));
  }
  
  log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = data 
      ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n`
      : `[${timestamp}] ${message}`;
    
    this.logs.push(logEntry);
    console.log(message, data || '');
  }
  
  logSection(title: string) {
    this.log(`\n${'='.repeat(60)}`);
    this.log(`${title.toUpperCase()}`);
    this.log('='.repeat(60));
  }
  
  logSubsection(title: string) {
    this.log(`\n--- ${title} ---`);
  }
  
  save() {
    const finalLog = this.logs.join('\n') + `\n\n${'='.repeat(80)}\nLOG COMPLETE - ${new Date().toISOString()}\n${'='.repeat(80)}`;
    fs.writeFileSync(this.logFile, finalLog, 'utf8');
    console.log(`📁 Complete analysis log saved: ${this.logFile}`);
    return this.logFile;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id }: AnalyzeRequest = await request.json();
    const logger = new PatternAnalysisLogger(video_id);

    if (!video_id) {
      return NextResponse.json(
        { error: 'video_id is required' },
        { status: 400 }
      );
    }


    logger.logSection('Initial Setup');
    logger.log(`🔍 [Enhanced] Analyzing pattern for video: ${video_id}`);

    // Get target video with baseline information
    const { data: targetVideo, error: videoError } = await supabase
      .from('videos')
      .select('*, channel_baseline_at_publish')
      .eq('id', video_id)
      .single();

    if (videoError || !targetVideo) {
      logger.log('❌ Video not found', { video_id, error: videoError });
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    logger.log(`📺 Target: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x TPS)`);
    logger.log(`🖼️ Thumbnail: ${targetVideo.thumbnail_url ? 'Available' : 'Missing'}`);
    logger.log('Target Video Data:', {
      id: targetVideo.id,
      title: targetVideo.title,
      channel: targetVideo.channel_name,
      views: targetVideo.view_count,
      performance_score: targetVideo.temporal_performance_score,
      baseline: targetVideo.channel_baseline_at_publish,
      thumbnail_url: targetVideo.thumbnail_url,
      niche: targetVideo.topic_niche || targetVideo.topic_domain
    });

    // Get 10 recent baseline videos from same channel (normal performers)
    const { data: baselineVideos } = await supabase
      .from('videos')
      .select('title, view_count, temporal_performance_score, llm_summary, published_at, thumbnail_url')
      .eq('channel_id', targetVideo.channel_id)
      .gte('temporal_performance_score', 0.8)
      .lte('temporal_performance_score', 1.2)
      .neq('id', video_id)
      .order('published_at', { ascending: false })
      .limit(10);

    logger.log(`📊 Found ${baselineVideos?.length || 0} baseline videos for comparison`);
    logger.log('Baseline Videos:', baselineVideos?.map(v => ({
      title: v.title,
      views: v.view_count,
      score: v.temporal_performance_score
    })));

    // Enhanced Step 1: Extract pattern using Claude with vision
    logger.logSection('Pattern Extraction with Claude Vision');
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    // Prepare baseline thumbnails for prompt construction
    const baselineThumbnails = (baselineVideos || []).filter(v => v.thumbnail_url).slice(0, 5);

    const extractionPrompt = `You are a YouTube performance analyst examining why one video dramatically outperformed a channel's baseline using systematic visual and content analysis.

CONTEXT:
- Channel: ${targetVideo.channel_name} (${targetVideo.topic_niche || targetVideo.topic_domain} content)
- Typical performance: ${(baselineVideos || []).map(v => ((v.temporal_performance_score || 1)).toFixed(1) + 'x').join(', ')} 
- Target breakthrough: ${targetVideo.view_count.toLocaleString()} views (${targetVideo.temporal_performance_score?.toFixed(1)}x multiplier)
- Audience: Content consumers in ${targetVideo.topic_niche || targetVideo.topic_domain} niche

TARGET VIDEO BREAKTHROUGH:
Title: "${targetVideo.title}"
Performance: ${targetVideo.temporal_performance_score?.toFixed(1)}x normal performance
Content: ${targetVideo.llm_summary || 'No summary available'}
Thumbnail: [First image provided - this is the breakthrough thumbnail to analyze]

BASELINE PATTERN (last 10 videos for comparison):
${(baselineVideos || []).map((v, i) => {
  const hasImage = baselineThumbnails.some(bt => bt.thumbnail_url === v.thumbnail_url);
  return `${i + 1}. Title: "${v.title}"
   Performance: ${((v.temporal_performance_score || 1)).toFixed(1)}x (${v.view_count?.toLocaleString()} views)
   Content: ${v.llm_summary || 'No summary available'}
   ${hasImage ? `Thumbnail: [Image ${baselineThumbnails.findIndex(bt => bt.thumbnail_url === v.thumbnail_url) + 2} provided]` : 'Thumbnail: Not available'}`
}).join('\n\n')}

VISUAL ANALYSIS INSTRUCTIONS:
- Image 1: Target breakthrough thumbnail (analyze this against baseline patterns)
- Images 2-${Math.min(6, 1 + baselineThumbnails.length)}: Baseline channel thumbnails (compare visual patterns)
- Focus on visual differentiation between breakthrough vs. normal channel style

SYSTEMATIC ANALYSIS FRAMEWORK:
Using chain of thought reasoning, analyze both visual and content patterns:

Step 1: VISUAL INVENTORY
Examine the breakthrough thumbnail's color psychology, typography choices, composition elements, visual hierarchy, and emotional triggers systematically.

Step 2: CONTENT DIFFERENTIATION  
Compare the breakthrough video's content approach, audience promise, and delivery method against the baseline pattern. What specific content strategy did they break from?

Step 3: BASELINE DIFFERENTIATION (Visual + Content)
Analyze how this video breaks from the channel's normal patterns in BOTH visual presentation and content approach. Consider:
- Visual: How does the thumbnail differ from their typical style?
- Content: How does the content promise/approach differ from their baseline videos?
- Audience Promise: What different value proposition does this offer?

Step 4: PSYCHOLOGICAL MECHANISM
Explain the specific psychological principle that makes viewers more likely to choose this content over the channel's typical offerings.

Step 5: PATTERN FORMULATION
Synthesize findings into a replicable pattern with clear success factors that combine both visual and content strategies.

OUTPUT FORMAT:
{
  "step_1_visual_inventory": {
    "colors": "Primary colors and their psychological impact",
    "typography": "Text style, size, placement analysis", 
    "composition": "Layout and visual hierarchy description",
    "focal_points": "What draws the eye first, second, third"
  },
  "step_2_content_differentiation": "How the breakthrough video's content approach differs from baseline pattern",
  "step_3_baseline_differentiation": {
    "visual_break": "How this thumbnail breaks from channel's visual norms",
    "content_break": "How this content promise differs from their typical offerings",
    "audience_promise_shift": "What different value proposition this provides"
  },
  "step_4_psychological_mechanism": "Why this specific combination triggers more engagement than baseline content",
  "step_5_pattern_formulation": {
    "pattern_name": "Memorable 2-4 word pattern name",
    "pattern_description": "One clear sentence explaining the core principle",
    "success_factors": ["Factor 1", "Factor 2", "Factor 3"],
    "replication_strategy": "How to apply this pattern to similar content",
    "content_strategy": "Specific content approach that enables this pattern",
    "visual_strategy": "Specific visual elements that support this pattern"
  },
  "confidence_level": "High/Medium/Low with brief justification",
  "channel_specific_insight": "Why this worked for THIS channel's audience specifically",
  "baseline_analysis": "Summary of what the channel normally does vs. this breakthrough approach"
}

VERIFICATION CHECK:
After analysis, confirm your visual observations are actually present in the thumbnail and align with established click-psychology principles.`;

    logger.log('Generated extraction prompt for Claude Vision API');
    logger.log('Extraction Prompt:', { prompt: extractionPrompt });

    // Create message content with IMAGES FIRST (Claude vision best practice)
    const messageContent: any[] = [];

    // Add target video thumbnail
    if (targetVideo.thumbnail_url) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'url',
          url: targetVideo.thumbnail_url
        }
      });
      logger.log(`🖼️ Adding target thumbnail to analysis: ${targetVideo.thumbnail_url}`);
    }

    // Add baseline video thumbnails (up to 5 for context without overwhelming)
    for (const baselineVideo of baselineThumbnails) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'url',
          url: baselineVideo.thumbnail_url
        }
      });
      logger.log(`🖼️ Adding baseline thumbnail: ${baselineVideo.title} - ${baselineVideo.thumbnail_url}`);
    }

    // THEN add text prompt (images analyzed in context with text)
    messageContent.push({ type: 'text', text: extractionPrompt });

    logger.log('Calling Claude Sonnet 4 API for superior pattern extraction...');
    const extractionStartTime = Date.now();
    
    // Initialize cost tracking
    let totalCosts = {
      claude: 0,
      openai: 0,
      replicate: 0,
      total: 0
    };
    const extractionResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',  // Claude Sonnet 4 for superior analysis
      max_tokens: 6000, // Increased for thinking + response
      temperature: 1, // Required for thinking
      thinking: {
        type: "enabled",
        budget_tokens: 4000 // Moderate thinking (4k tokens) - optimal from A/B testing
      },
      messages: [{ 
        role: 'user', 
        content: messageContent
      }]
    });
    const extractionDuration = Date.now() - extractionStartTime;
    
    // Calculate actual costs for pattern extraction
    const hasVision = !!targetVideo.thumbnail_url;
    const inputTokens = extractionResponse.usage?.input_tokens || 0;
    const outputTokens = extractionResponse.usage?.output_tokens || 0;
    const thinkingTokens = extractionResponse.usage?.thinking_tokens || 0;
    
    // Claude Sonnet 4 pricing (per 1M tokens): Input $15, Output $75, Thinking $75
    const inputCost = inputTokens * 15 / 1000000;
    const outputCost = outputTokens * 75 / 1000000;
    const thinkingCost = thinkingTokens * 75 / 1000000;
    const extractionCost = inputCost + outputCost + thinkingCost;
    totalCosts.claude += extractionCost;
    
    logger.log(`💰 Pattern extraction cost: $${extractionCost.toFixed(6)} (${inputTokens} input + ${outputTokens} output${thinkingTokens > 0 ? ` + ${thinkingTokens} thinking` : ''} tokens${hasVision ? ' + vision' : ''})`);

    // Handle extended thinking responses - filter for text content blocks only
    const textBlocks = extractionResponse.content.filter(block => block.type === 'text');
    const thinkingBlocks = extractionResponse.content.filter(block => block.type === 'thinking');
    
    if (textBlocks.length === 0) {
      logger.log('❌ No text content blocks found in Claude response', { 
        contentTypes: extractionResponse.content.map(block => block.type) 
      });
      throw new Error('No text content found in Claude response');
    }

    // Combine all text blocks (usually just one, but handle multiple)
    const responseText = textBlocks.map(block => block.text).join('').trim();
    
    // Capture thinking content for debug panel
    const thinkingContent = thinkingBlocks.map(block => block.thinking).join('\n');
    
    logger.log(`✅ Claude response received in ${extractionDuration}ms`);
    logger.log('Raw Claude Response:', { 
      response: responseText,
      thinkingBlocks: thinkingBlocks.length,
      usage: extractionResponse.usage,
      model: extractionResponse.model 
    });

    let pattern: ExtractedPattern;
    try {
      // More robust JSON extraction and validation
      
      // Check for unexpected content contamination
      if (responseText.includes('newsletter') || responseText.includes('unsubscribe') || responseText.includes('deals')) {
        logger.log('⚠️ Possible content contamination detected in Claude response');
        throw new Error('Claude response appears to contain unexpected content');
      }
      
      // Handle both direct JSON and code-block wrapped JSON (Sonnet 4 format)
      let jsonMatch = responseText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
      if (!jsonMatch) {
        // More flexible JSON extraction - find the largest JSON object
        jsonMatch = responseText.match(/\{[\s\S]*\}/);
      } else {
        // Use the captured JSON content from code block
        jsonMatch[0] = jsonMatch[1];
      }
      
      if (!jsonMatch) {
        logger.log('❌ No valid JSON found in Claude response', { responseText: responseText.slice(0, 500) });
        throw new Error('No JSON found in response');
      }
      
      const rawPattern = JSON.parse(jsonMatch[0]);
      
      // Transform improved format to legacy format for compatibility
      if (rawPattern.step_5_pattern_formulation) {
        // New enhanced format - transform to legacy structure
        pattern = {
          pattern_name: rawPattern.step_5_pattern_formulation.pattern_name,
          pattern_description: rawPattern.step_5_pattern_formulation.pattern_description,
          psychological_trigger: rawPattern.step_4_psychological_mechanism,
          key_elements: rawPattern.step_1_visual_inventory?.focal_points?.split(', ') || [],
          visual_elements: [
            rawPattern.step_1_visual_inventory?.colors,
            rawPattern.step_1_visual_inventory?.typography,
            rawPattern.step_1_visual_inventory?.composition
          ].filter(Boolean),
          thumbnail_psychology: rawPattern.step_4_psychological_mechanism,
          design_quality_score: 8.5, // Default score
          design_strengths: rawPattern.step_5_pattern_formulation.success_factors || [],
          marketing_positioning: rawPattern.step_2_content_differentiation,
          competitive_advantage: rawPattern.step_5_pattern_formulation.replication_strategy,
          why_it_works: `VISUAL: ${rawPattern.step_5_pattern_formulation?.visual_strategy || 'N/A'}. CONTENT: ${rawPattern.step_5_pattern_formulation?.content_strategy || 'N/A'}. PSYCHOLOGY: ${rawPattern.step_4_psychological_mechanism}. STRATEGY: ${rawPattern.step_5_pattern_formulation?.replication_strategy || 'N/A'}.`,
          semantic_queries: generateSemanticQueries(rawPattern),
          visual_queries: generateVisualQueries(rawPattern),
          channel_outlier_explanation: rawPattern.channel_specific_insight,
          differentiation_factor: rawPattern.step_3_baseline_differentiation?.content_break,
          // Additional enhanced format fields
          step_1_visual_inventory: rawPattern.step_1_visual_inventory,
          step_2_content_differentiation: rawPattern.step_2_content_differentiation,
          step_3_baseline_differentiation: rawPattern.step_3_baseline_differentiation,
          step_4_psychological_mechanism: rawPattern.step_4_psychological_mechanism,
          step_5_pattern_formulation: rawPattern.step_5_pattern_formulation,
          confidence_level: rawPattern.confidence_level,
          channel_specific_insight: rawPattern.channel_specific_insight,
          baseline_analysis: rawPattern.baseline_analysis
        };
      } else {
        // Legacy format - use as is
        pattern = rawPattern;
      }
      
      // Validate required fields
      const requiredFields = ['pattern_name'];
      const missingFields = requiredFields.filter(field => !pattern[field]);
      if (missingFields.length > 0) {
        logger.log('❌ Missing required fields in pattern', { missingFields, pattern });
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }
      
      logger.log('✅ Successfully parsed and validated pattern from Claude response');
      logger.log('Extracted Pattern:', pattern);
    } catch (parseError) {
      logger.log('❌ Failed to parse Claude response', { 
        error: parseError, 
        response: content.text 
      });
      throw new Error('Failed to parse pattern extraction');
    }

    logger.log(`✅ Pattern extracted: ${pattern.pattern_name}`);
    logger.log(`📝 Text queries: ${pattern.semantic_queries?.join(', ')}`);
    logger.log(`🎨 Visual queries: ${pattern.visual_queries?.join(', ') || 'None'}`);
    
    // Extract thinking content for debug panel
    // Thinking content already captured above
    if (thinkingContent) {
      logger.log(`🧠 Extended thinking: ${thinkingTokens} tokens used for enhanced analysis`);
    }
    
    const debugInfo = {
      extraction: {
        promptTokens: inputTokens,
        responseTokens: outputTokens,
        thinkingTokens: thinkingTokens,
        thinkingContent: thinkingContent,
        model: 'claude-sonnet-4-20250514',  // Claude Sonnet 4 with thinking enabled
        validation_model: 'claude-3-haiku-20240307',  // Haiku for efficient validation
        temperature: 1, // Required for thinking
        extendedThinking: true, // Enabled with 4k thinking tokens
        thumbnailAnalyzed: !!targetVideo.thumbnail_url
      },
      queries: {
        text: pattern.semantic_queries || [],
        visual: pattern.visual_queries || []
      },
      searchResults: [] as any[],
      visualSearchResults: [] as any[],
      validation: {} as any,
      thresholds: {
        similarity: { titles: 0.5, summaries: 0.4, thumbnails: 0.5 },
        performance: 2.5,
        maxValidations: 20
      },
      searchLogs: [] as string[],
      searchTimings: {
        textSearches: [] as Array<{ query: string; duration: number; titleResults: number; summaryResults: number }>,
        visualSearches: [] as Array<{ query: string; duration: number; results: number; error?: string }>
      }
    };

    // Step 2: Validate pattern using multi-namespace semantic search
    const validationResults: ValidationResult[] = [];
    const openaiKey = process.env.OPENAI_API_KEY!;
    
    // Track all unique videos found across searches
    const allFoundVideos = new Map<string, { 
      video_id: string, 
      similarity_score: number, 
      source: 'title' | 'summary' | 'thumbnail',
      query: string 
    }>();
    
    // Step 2: Validate pattern using multi-namespace semantic search
    logger.logSection('Multi-Modal Search Phase');
    
    // Step 2a: Text-based semantic search (existing logic)
    logger.logSubsection('Text-Based Semantic Searches');
    logger.log(`🔎 Starting text-based semantic searches...`);
    debugInfo.searchLogs.push('🔎 Starting text-based semantic searches...');
    
    for (const query of pattern.semantic_queries || []) {
      const searchStartTime = Date.now();
      logger.log(`  Searching text for: "${query}"`);
      debugInfo.searchLogs.push(`  Searching text for: "${query}"`);
      
      try {
        // Generate embedding for the query
        const embeddingStartTime = Date.now();
        logger.log(`    Generating OpenAI embedding for query...`);
        const queryEmbedding = await generateQueryEmbedding(query, openaiKey);
        const embeddingDuration = Date.now() - embeddingStartTime;
        logger.log(`    Generated embedding in ${embeddingDuration}ms (${queryEmbedding.length}D)`);
        debugInfo.searchLogs.push(`    Generated embedding in ${embeddingDuration}ms`);
        
        // OpenAI text-embedding-3-small pricing: $0.02 per 1M tokens
        const embeddingTokens = Math.ceil(query.split(' ').length * 1.2);
        const embeddingCost = embeddingTokens * 0.02 / 1000000;
        totalCosts.openai += embeddingCost;
        
        // Search both title and summary namespaces in parallel
        const searchParallelStart = Date.now();
        logger.log(`    Executing parallel Pinecone searches (title + summary)...`);
        const [titleResults, summaryResults] = await Promise.all([
          pineconeService.searchSimilar(queryEmbedding, 20, 0.5, 0, undefined),
          pineconeService.searchSimilar(queryEmbedding, 20, 0.4, 0, 'llm-summaries')
        ]);
        const parallelDuration = Date.now() - searchParallelStart;
        
        logger.log(`    Parallel search completed in ${parallelDuration}ms`);
        logger.log('Title Search Results:', {
          found: titleResults.results.length,
          avgSimilarity: titleResults.results.length > 0 ? 
            (titleResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / titleResults.results.length).toFixed(3) : 0,
          topResults: titleResults.results.slice(0, 3).map(r => ({
            title: r.title,
            score: r.similarity_score.toFixed(3),
            views: r.view_count
          }))
        });
        logger.log('Summary Search Results:', {
          found: summaryResults.results.length,
          avgSimilarity: summaryResults.results.length > 0 ? 
            (summaryResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / summaryResults.results.length).toFixed(3) : 0,
          topResults: summaryResults.results.slice(0, 3).map(r => ({
            title: r.title,
            score: r.similarity_score.toFixed(3),
            views: r.view_count
          }))
        });
        
        console.log(`    Title search: ${titleResults.results.length} results`);
        console.log(`    Summary search: ${summaryResults.results.length} results`);
        
        // Add to debug logs
        debugInfo.searchLogs.push(`    Title search: ${titleResults.results.length} results (avg similarity: ${titleResults.results.length > 0 ? (titleResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / titleResults.results.length).toFixed(3) : 0})`);
        debugInfo.searchLogs.push(`    Summary search: ${summaryResults.results.length} results (avg similarity: ${summaryResults.results.length > 0 ? (summaryResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / summaryResults.results.length).toFixed(3) : 0})`);
        debugInfo.searchLogs.push(`    Parallel search completed in ${parallelDuration}ms`);
        
        // Record timing
        const totalDuration = Date.now() - searchStartTime;
        debugInfo.searchTimings.textSearches.push({
          query,
          duration: totalDuration,
          titleResults: titleResults.results.length,
          summaryResults: summaryResults.results.length
        });
        
        // Add to debug info
        debugInfo.searchResults.push({
          query,
          duration: totalDuration,
          titleSearch: {
            found: titleResults.results.length,
            avgSimilarity: titleResults.results.length > 0 ? 
              titleResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / titleResults.results.length : 0,
            threshold: 0.5,
            topScores: titleResults.results.slice(0, 3).map(r => r.similarity_score)
          },
          summarySearch: {
            found: summaryResults.results.length,
            avgSimilarity: summaryResults.results.length > 0 ?
              summaryResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / summaryResults.results.length : 0,
            threshold: 0.4,
            topScores: summaryResults.results.slice(0, 3).map(r => r.similarity_score)
          }
        });
        
        // Add results to tracking
        titleResults.results.forEach(r => {
          const existing = allFoundVideos.get(r.video_id);
          if (!existing || existing.similarity_score < r.similarity_score) {
            allFoundVideos.set(r.video_id, {
              video_id: r.video_id,
              similarity_score: r.similarity_score,
              source: 'title',
              query
            });
          }
        });
        
        summaryResults.results.forEach(r => {
          const existing = allFoundVideos.get(r.video_id);
          const weightedScore = r.similarity_score * 1.2;
          if (!existing || existing.similarity_score < weightedScore) {
            allFoundVideos.set(r.video_id, {
              video_id: r.video_id,
              similarity_score: weightedScore,
              source: 'summary',
              query
            });
          }
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Text search failed for "${query}":`, error);
        debugInfo.searchLogs.push(`❌ Text search failed for "${query}": ${errorMessage}`);
        
        // Record failed timing
        const totalDuration = Date.now() - searchStartTime;
        debugInfo.searchTimings.textSearches.push({
          query,
          duration: totalDuration,
          titleResults: 0,
          summaryResults: 0
        });
      }
    }
    
    // Step 2b: Visual-based search using thumbnail embeddings
    logger.logSubsection('Visual-Based Thumbnail Searches');
    logger.log(`🎨 Starting visual-based thumbnail searches...`);
    debugInfo.searchLogs.push('🎨 Starting visual-based thumbnail searches...');
    
    for (const visualQuery of pattern.visual_queries || []) {
      const visualSearchStart = Date.now();
      logger.log(`  Searching thumbnails for: "${visualQuery}"`);
      debugInfo.searchLogs.push(`  Searching thumbnails for: "${visualQuery}"`);
      
      try {
        // Generate CLIP embedding for visual query (768D, compatible with thumbnail index)
        const embeddingStart = Date.now();
        logger.log(`    Generating CLIP text embedding for visual search...`);
        const visualEmbedding = await generateVisualQueryEmbedding(visualQuery);
        const embeddingDuration = Date.now() - embeddingStart;
        logger.log(`    Generated CLIP embedding in ${embeddingDuration}ms (${visualEmbedding.length}D)`);
        debugInfo.searchLogs.push(`    Generated CLIP embedding in ${embeddingDuration}ms (${visualEmbedding.length}D)`);
        
        // Replicate CLIP embedding pricing: roughly $0.001 per call
        const replicateCost = 0.001;
        totalCosts.replicate += replicateCost;
        
        // Search dedicated thumbnail index (separate from main index)
        const searchStart = Date.now();
        logger.log(`    Searching dedicated thumbnail index...`);
        const thumbnailSearchResults = await pineconeThumbnailService.searchSimilarThumbnails(
          visualEmbedding,
          25,
          0.2  // Lower threshold for CLIP cross-modal similarity (actual range ~0.27-0.30)
        );
        const searchDuration = Date.now() - searchStart;
        
        const avgSimilarity = thumbnailSearchResults.results.length > 0 ?
          thumbnailSearchResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / thumbnailSearchResults.results.length : 0;
        
        logger.log(`    Thumbnail search completed in ${searchDuration}ms`);
        logger.log('Thumbnail Search Results:', {
          found: thumbnailSearchResults.results.length,
          avgSimilarity: avgSimilarity.toFixed(3),
          threshold: 0.2,
          topResults: thumbnailSearchResults.results.slice(0, 3).map(r => ({
            title: r.title,
            score: r.similarity_score.toFixed(3),
            views: r.view_count,
            channel: r.channel_name
          }))
        });
        
        debugInfo.searchLogs.push(`    Thumbnail search: ${thumbnailSearchResults.results.length} results (avg similarity: ${avgSimilarity.toFixed(3)})`);
        debugInfo.searchLogs.push(`    Visual search completed in ${searchDuration}ms`);
        
        const totalDuration = Date.now() - visualSearchStart;
        
        // Add to visual search debug info
        debugInfo.visualSearchResults.push({
          query: visualQuery,
          found: thumbnailSearchResults.results.length,
          threshold: 0.2,
          embedding_type: 'CLIP-768D',
          duration: totalDuration,
          avgSimilarity,
          topScores: thumbnailSearchResults.results.slice(0, 3).map(r => r.similarity_score)
        });
        
        // Record timing
        debugInfo.searchTimings.visualSearches.push({
          query: visualQuery,
          duration: totalDuration,
          results: thumbnailSearchResults.results.length
        });
        
        // Add thumbnail results with higher weight for visual matches
        thumbnailSearchResults.results.forEach(r => {
          const existing = allFoundVideos.get(r.video_id);
          const visualWeight = r.similarity_score * 1.3;
          if (!existing || existing.similarity_score < visualWeight) {
            allFoundVideos.set(r.video_id, {
              video_id: r.video_id,
              similarity_score: visualWeight,
              source: 'thumbnail',
              query: visualQuery
            });
          }
        });
        
        debugInfo.searchLogs.push(`    Added ${thumbnailSearchResults.results.length} visual matches to tracking`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const totalDuration = Date.now() - visualSearchStart;
        
        console.warn(`⚠️ Visual search failed for "${visualQuery}":`, error);
        debugInfo.searchLogs.push(`⚠️ Visual search failed for "${visualQuery}": ${errorMessage}`);
        
        // Record failed visual search
        debugInfo.searchTimings.visualSearches.push({
          query: visualQuery,
          duration: totalDuration,
          results: 0,
          error: errorMessage
        });
        
        debugInfo.visualSearchResults.push({
          query: visualQuery,
          found: 0,
          threshold: 0.2,
          embedding_type: 'CLIP-768D',
          duration: totalDuration,
          error: errorMessage
        });
      }
    }
    
    console.log(`📊 Total unique videos found: ${allFoundVideos.size} across all searches`);
    debugInfo.searchLogs.push(`📊 Total unique videos found: ${allFoundVideos.size} across all searches`);
      
    // Step 3: Get full video data and validate with LLM
    logger.logSection('Video Validation with Enhanced LLM Analysis');
    if (allFoundVideos.size > 0) {
      const videoIds = Array.from(allFoundVideos.keys());
      logger.log(`📋 Getting full video data for ${videoIds.length} unique videos...`);
      debugInfo.searchLogs.push(`📋 Getting full video data for ${videoIds.length} unique videos...`);
      
      // Get full video data with performance scores and summaries
      const { data: allVideos } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, temporal_performance_score, topic_niche, topic_domain, llm_summary, thumbnail_url')
        .in('id', videoIds)
        .gte('temporal_performance_score', 1.5) // Further lowered to catch more candidates
        .lte('temporal_performance_score', 100); // Cap at 100x to exclude corrupted data

      // TEST A: Rank by search similarity scores for better candidate selection
      const videosWithSimilarity = (allVideos || []).map(video => {
        const matchInfo = allFoundVideos.get(video.id);
        let relevanceScore = 0;
        let avgSimilarity = 0;
        let queryMatches = 0;

        if (matchInfo) {
          // Calculate relevance based on search query matches and similarity scores
          queryMatches = 1;
          avgSimilarity = matchInfo.similarity_score || 0;
          
          // Bonus for high-value queries
          if (matchInfo.query.includes('social utility')) relevanceScore += 3;
          if (matchInfo.query.includes('impossible transformation')) relevanceScore += 2;
          if (matchInfo.query.includes('curiosity gap')) relevanceScore += 2;
          if (matchInfo.query.includes('pattern examples')) relevanceScore += 1;
        }

        return {
          ...video,
          relevanceScore: relevanceScore + avgSimilarity,
          avgSimilarity,
          queryMatches
        };
      });

      // Sort by relevance score (combination of query importance and similarity)
      const videos = videosWithSimilarity
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 25); // Top 25 most relevant candidates
      
      logger.log(`📊 TEST A: Ranked by search similarity - Top ${videos?.length || 0} most relevant candidates`);
      debugInfo.searchLogs.push(`📊 TEST A: Ranked by search similarity - Top ${videos?.length || 0} most relevant candidates`);
      
      if (videos && videos.length > 0) {
        logger.log('Top Candidates by Relevance:', videos.slice(0, 5).map(v => ({
          title: v.title?.slice(0, 40) + '...',
          score: v.temporal_performance_score?.toFixed(1) + 'x',
          relevance: v.relevanceScore?.toFixed(2),
          similarity: v.avgSimilarity?.toFixed(3),
          queries: v.queryMatches
        })));
      }
      
      if (videos && videos.length > 0) {
        logger.log('High-Performing Videos for Validation:', videos.map(v => ({
          title: v.title,
          views: v.view_count,
          score: v.temporal_performance_score,
          channel: v.channel_name,
          hasThumbnail: !!v.thumbnail_url
        })));
      }
      
      // Step 4: Enhanced LLM validation with visual analysis
      const validatedVideos: Array<{
        video: typeof videos[0],
        isValid: boolean,
        reason: string,
        visualMatch?: string,
        source: 'title' | 'summary' | 'thumbnail'
      }> = [];
      
      if (videos && videos.length > 0) {
        logger.logSubsection('Enhanced LLM Validation Process');
        logger.log(`🤖 Starting enhanced LLM validation for ${videos.length} videos...`);
        debugInfo.searchLogs.push(`🤖 Starting enhanced LLM validation for ${videos.length} videos...`);
        
        // Process videos individually for better visual analysis
        for (const video of videos) {
          const validationStart = Date.now();
          const matchInfo = allFoundVideos.get(video.id);
          
          // TEST A: Enhanced structured validation prompt for better reasoning
          const validationPrompt = `PATTERN VALIDATION ANALYSIS

ORIGINAL PATTERN (${targetVideo.niche}):
Pattern: "${pattern.pattern_name}"
Psychology: ${pattern.psychological_trigger?.substring(0, 200)}...
Transformation: ${pattern.differentiation_factor || 'Skill mastery to social utility'}

CANDIDATE VIDEO:
Title: "${video.title}"
Channel: ${video.channel_name} 
Content: ${video.llm_summary?.substring(0, 200) || 'No summary available'}
Niche: ${video.topic_niche || video.topic_domain}
Performance: ${video.temporal_performance_score?.toFixed(1)}x baseline

ANALYSIS TASK:
1. MATCH (Yes/No): ___
2. TRANSFORMATION: FROM "____" TO "____" 
3. PSYCHOLOGY: How does it promise social utility? ___
4. CROSS-NICHE REASON: Why same appeal as original pattern? ___

Keep each answer to 1-2 sentences. Focus on the psychological shift, not surface features.

Format: MATCH: Yes/No | TRANSFORMATION: [brief] | PSYCHOLOGY: [brief] | REASON: [brief]`;

          // Create validation content
          const validationContent: any[] = [
            { type: 'text', text: validationPrompt }
          ];

          if (video.thumbnail_url) {
            validationContent.push({
              type: 'image',
              source: {
                type: 'url', 
                url: video.thumbnail_url
              }
            });
          }

          try {
            const validationResponse = await anthropic.messages.create({
              model: 'claude-3-haiku-20240307',  // Haiku for efficient validation
              max_tokens: 100,
              temperature: 0.3,
              messages: [{
                role: 'user',
                content: validationContent
              }]
            });
            
            // Track validation costs (Haiku pricing: includes vision if thumbnail present)
            const validationInputTokens = validationResponse.usage?.input_tokens || 0;
            const validationOutputTokens = validationResponse.usage?.output_tokens || 0;
            const hasValidationVision = !!video.thumbnail_url;
            const validationInputCost = hasValidationVision ? 
              (validationInputTokens * 0.3 / 1000000) : (validationInputTokens * 0.25 / 1000000);
            const validationOutputCost = validationOutputTokens * 1.25 / 1000000;
            const validationCost = validationInputCost + validationOutputCost;
            totalCosts.claude += validationCost;

            const validationContent2 = validationResponse.content[0];
            if (validationContent2.type === 'text') {
              const response = validationContent2.text.trim();
              const validationDuration = Date.now() - validationStart;
              
              // TEST A: Parse new structured response format
              const matchMatch = response.match(/MATCH:\s*(Yes|No)/i);
              const isYes = matchMatch && matchMatch[1].toLowerCase() === 'yes';
              
              if (isYes) {
                // Extract structured components
                const transformationMatch = response.match(/TRANSFORMATION:\s*([^|]+)/i);
                const psychologyMatch = response.match(/PSYCHOLOGY:\s*([^|]+)/i);
                const reasonMatch = response.match(/REASON:\s*([^|]+)/i);
                
                const transformation = transformationMatch?.[1]?.trim() || '';
                const psychology = psychologyMatch?.[1]?.trim() || '';
                const crossNicheReason = reasonMatch?.[1]?.trim() || '';
                
                // Combine for comprehensive reasoning
                const enhancedReason = [
                  transformation && `Transforms: ${transformation}`,
                  psychology && `Psychology: ${psychology}`,
                  crossNicheReason && `Cross-niche appeal: ${crossNicheReason}`
                ].filter(Boolean).join(' | ');
                
                validatedVideos.push({
                  video,
                  isValid: true,
                  reason: enhancedReason || 'Pattern match identified',
                  visualMatch: undefined,
                  source: matchInfo?.source || 'summary'
                });
                
                console.log(`    ✅ "${video.title}" - ${enhancedReason}`);
                debugInfo.searchLogs.push(`    ✅ Validated "${video.title.slice(0, 50)}..." in ${validationDuration}ms (${matchInfo?.sources?.[0]?.source || 'unknown'} source)`);
                
                logger.log(`✅ Validated: "${video.title}" - ${enhancedReason}`);
              } else {
                debugInfo.searchLogs.push(`    ❌ Rejected "${video.title.slice(0, 50)}..." in ${validationDuration}ms - ${response.slice(0, 100)}`);
              }
            }
          } catch (error) {
            const validationDuration = Date.now() - validationStart;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.warn(`⚠️ Validation failed for video ${video.id}:`, error);
            debugInfo.searchLogs.push(`    ⚠️ Validation failed for "${video.title.slice(0, 50)}..." in ${validationDuration}ms: ${errorMessage}`);
          }
        }
        
        logger.log(`✅ Enhanced validation complete: ${validatedVideos.length} videos confirmed`);
        logger.log('Final Validated Videos:', validatedVideos.map(v => ({
          title: v.video.title,
          score: v.video.temporal_performance_score,
          channel: v.video.channel_name,
          reason: v.reason,
          visualMatch: v.visualMatch,
          source: v.source
        })));
        debugInfo.searchLogs.push(`✅ Enhanced validation complete: ${validatedVideos.length} videos confirmed`);
        
        // Add validation info to debug
        debugInfo.validation = {
          totalVideosFound: allFoundVideos.size,
          afterPerformanceFilter: videos.length,
          validated: validatedVideos.length,
          validationRate: (validatedVideos.length / Math.max(1, videos.length) * 100).toFixed(1) + '%',
          sourceBreakdown: {
            title: validatedVideos.filter(v => v.source === 'title').length,
            summary: validatedVideos.filter(v => v.source === 'summary').length,
            thumbnail: validatedVideos.filter(v => v.source === 'thumbnail').length
          }
        };
        
        // Group validated videos by niche
        const nicheGroups: Record<string, typeof validatedVideos> = {};
        validatedVideos.forEach((validatedVideo) => {
          const niche = validatedVideo.video.topic_niche || validatedVideo.video.topic_domain || 'Unknown';
          if (!nicheGroups[niche]) nicheGroups[niche] = [];
          nicheGroups[niche].push(validatedVideo);
        });
        
        // Build enhanced validation results
        Object.entries(nicheGroups).forEach(([niche, validatedVids]) => {
          validationResults.push({
            niche,
            videos: validatedVids.slice(0, 4).map(v => ({
              title: v.video.title,
              score: v.video.temporal_performance_score || 0,
              views: v.video.view_count,
              channel: v.video.channel_name,
              thumbnail_url: v.video.thumbnail_url,
              summary: v.video.llm_summary || 'No summary available',
              validation_reason: v.reason,
              visual_match: v.visualMatch,
              source: v.source
            })),
            avg_score: validatedVids.reduce((sum, v) => sum + (v.video.temporal_performance_score || 0), 0) / validatedVids.length,
            count: validatedVids.length
          });
        });
      }
    }
    
    // Sort validation results by average score
    validationResults.sort((a, b) => b.avg_score - a.avg_score);
    
    // Calculate enhanced pattern strength
    const totalValidations = validationResults.reduce((sum, r) => sum + r.count, 0);
    const avgPatternScore = validationResults.length > 0
      ? validationResults.reduce((sum, r) => sum + r.avg_score, 0) / validationResults.length
      : 0;
    
    const visualValidations = validationResults.reduce((sum, r) => 
      sum + r.videos.filter(v => v.visual_match).length, 0
    );
    
    logger.log('Pre-Calculation Metrics:', {
      validationResults: validationResults.length,
      totalValidations,
      avgPatternScore,
      visualValidations,
      resultDetails: validationResults.map(r => ({
        niche: r.niche,
        count: r.count,
        avg_score: r.avg_score,
        visualMatches: r.videos.filter(v => v.visual_match).length
      }))
    });
    
    // Enhanced pattern strength calculation for multi-modal analysis
    const hasVisualValidation = visualValidations > 0;
    const multiModalBonus = hasVisualValidation ? 1.5 : 1.0; // Boost strength when visual matches exist
    const adjustedAvgScore = avgPatternScore * multiModalBonus;
    
    const patternStrength = 
      (totalValidations >= 6 && adjustedAvgScore >= 4) ? 'strong' :
      (totalValidations >= 3 && adjustedAvgScore >= 2.5) || (totalValidations >= 2 && adjustedAvgScore >= 3) ? 'moderate' : 
      'weak';
    
    logger.log('Pattern Strength Calculation:', {
      totalValidations,
      avgPatternScore,
      visualValidations,
      hasVisualValidation,
      multiModalBonus,
      adjustedAvgScore,
      finalStrength: patternStrength
    });

    // Calculate channel statistics
    const channelAvgViews = baselineVideos && baselineVideos.length > 0
      ? Math.round(baselineVideos.reduce((sum, v) => sum + v.view_count, 0) / baselineVideos.length)
      : targetVideo.channel_baseline_at_publish || Math.round(targetVideo.view_count / targetVideo.temporal_performance_score);
    
    const performanceMultiplier = targetVideo.view_count / channelAvgViews;
    const percentileRank = baselineVideos 
      ? Math.round((baselineVideos.filter(v => v.view_count < targetVideo.view_count).length / baselineVideos.length) * 100)
      : 95; // Default to top 5% if no baseline available

    const processingTime = Date.now() - startTime;
    
    // Final results and logging
    logger.logSection('Analysis Complete - Final Results');
    logger.log(`✅ Enhanced pattern analysis complete in ${processingTime}ms`);
    logger.log(`📊 Found ${totalValidations} validations (${visualValidations} with visual matches) across ${validationResults.length} niches`);
    
    const finalResults = {
      enhanced: true,
      pattern,
      source_video: {
        id: targetVideo.id,
        title: targetVideo.title,
        channel: targetVideo.channel_name,
        score: targetVideo.temporal_performance_score,
        niche: targetVideo.topic_niche || targetVideo.topic_domain,
        views: targetVideo.view_count,
        thumbnail: targetVideo.thumbnail_url,
        baseline: targetVideo.channel_baseline_at_publish,
        published_at: targetVideo.published_at,
        summary: targetVideo.llm_summary
      },
      baseline_videos: (baselineVideos || []).map(v => ({
        title: v.title,
        views: v.view_count,
        score: v.temporal_performance_score,
        summary: v.llm_summary,
        thumbnail_url: v.thumbnail_url,
        published_at: v.published_at
      })),
      baseline_analysis: pattern.baseline_analysis,
      channel_insight: pattern.channel_specific_insight,
      differentiation_factor: pattern.differentiation_factor,
      validation: {
        results: validationResults.slice(0, 8), // Top 8 niches
        total_validations: totalValidations,
        visual_validations: visualValidations,
        pattern_strength: patternStrength,
        avg_pattern_score: avgPatternScore
      },
      processing_time_ms: processingTime,
      debug: {
        total_searches: (pattern.semantic_queries?.length || 0) + (pattern.visual_queries?.length || 0),
        text_searches: pattern.semantic_queries?.length || 0,
        visual_searches: pattern.visual_queries?.length || 0,
        unique_videos_found: allFoundVideos.size,
        thumbnail_analysis_enabled: !!targetVideo.thumbnail_url,
        // Enhanced debug info for debug panel
        searchLogs: debugInfo.searchLogs,
        searchTimings: debugInfo.searchTimings,
        searchResults: debugInfo.searchResults,
        visualSearchResults: debugInfo.visualSearchResults,
        validation: debugInfo.validation,
        extraction: debugInfo.extraction,
        thresholds: debugInfo.thresholds
      }
    };
    
    // Calculate final costs
    totalCosts.total = totalCosts.claude + totalCosts.openai + totalCosts.replicate;
    
    // Log final cost summary
    logger.logSection('Cost Summary');
    logger.log(`💰 Claude API (vision enabled): $${totalCosts.claude.toFixed(6)}`);
    logger.log(`💰 OpenAI embeddings: $${totalCosts.openai.toFixed(6)}`);
    logger.log(`💰 Replicate CLIP: $${totalCosts.replicate.toFixed(6)}`);
    logger.log(`💰 TOTAL ANALYSIS COST: $${totalCosts.total.toFixed(6)}`);
    
    // Add costs to results
    finalResults.costs = {
      claude: totalCosts.claude,
      openai: totalCosts.openai,
      replicate: totalCosts.replicate,
      total: totalCosts.total,
      breakdown: {
        pattern_extraction: extractionCost,
        text_embeddings: totalCosts.openai,
        visual_embeddings: totalCosts.replicate,
        validations: totalCosts.claude - extractionCost
      }
    };
    
    logger.log('Complete Analysis Results:', finalResults);
    
    // Save complete log file
    const logFilePath = logger.save();
    console.log(`📁 Complete analysis log saved: ${logFilePath}`);

    return NextResponse.json(finalResults);

  } catch (error) {
    console.error('❌ Pattern analysis failed:', error);
    
    // Try to save error log if logger exists
    if (typeof logger !== 'undefined') {
      logger.log('❌ ANALYSIS FAILED', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      try {
        logger.save();
      } catch (logError) {
        console.error('Failed to save error log:', logError);
      }
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze pattern (enhanced)',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}