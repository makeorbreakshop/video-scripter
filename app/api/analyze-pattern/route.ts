/**
 * Pattern Analysis API - Extracts patterns and validates across niches
 * POST /api/analyze-pattern
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';
import { pineconeThumbnailService } from '@/lib/pinecone-thumbnail-service';
import { generateVisualQueryEmbedding } from '@/lib/thumbnail-embeddings';
import fs from 'fs';
import path from 'path';

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
  why_it_works: string;
  semantic_queries: string[];
  visual_queries?: string[];
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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

    const extractionPrompt = `You are analyzing a viral YouTube video to extract transferable success patterns. You will analyze both the text content AND the thumbnail visual.

TARGET VIDEO (${targetVideo.temporal_performance_score?.toFixed(1)}x performance):
Title: "${targetVideo.title}"
Views: ${targetVideo.view_count.toLocaleString()}
Channel: ${targetVideo.channel_name}
Niche: ${targetVideo.topic_niche || targetVideo.topic_domain}
${targetVideo.llm_summary ? `Summary: ${targetVideo.llm_summary}` : ''}

CHANNEL BASELINE (normal performers):
${(baselineVideos || []).map((v, i) => 
  `${i + 1}. "${v.title}" - ${v.view_count.toLocaleString()} views (${v.temporal_performance_score?.toFixed(1)}x)`
).join('\n')}

Analyze what makes the target video different from the baseline, considering BOTH text and visual elements.

For the thumbnail analysis, focus on:
- Facial expressions and emotions
- Color scheme and mood
- Composition and framing
- Text overlays or graphics
- How the visual reinforces or contrasts with the title

Return a JSON object with enhanced fields:
{
  "pattern_name": "Short, memorable name (max 5 words)",
  "pattern_description": "One sentence explaining the pattern in simple terms",
  "psychological_trigger": "Why humans can't resist watching (one sentence)",
  "key_elements": ["Text Element 1", "Text Element 2", "Text Element 3"],
  "visual_elements": ["Visual Element 1", "Visual Element 2", "Visual Element 3"],
  "thumbnail_psychology": "How the thumbnail emotion/composition supports the pattern (one sentence)",
  "why_it_works": "Why this gets clicks (one sentence)",
  "semantic_queries": ["query 1", "query 2", "query 3"],
  "visual_queries": ["visual pattern 1", "visual pattern 2"],
  "channel_outlier_explanation": "Why this video exploded compared to baseline (1-2 sentences)"
}`;

    logger.log('Generated extraction prompt for Claude Vision API');
    logger.log('Extraction Prompt:', { prompt: extractionPrompt });

    // Create message content - add image if thumbnail exists
    const messageContent: any[] = [
      { type: 'text', text: extractionPrompt }
    ];

    if (targetVideo.thumbnail_url) {
      messageContent.push({
        type: 'image',
        source: {
          type: 'url',
          url: targetVideo.thumbnail_url
        }
      });
      logger.log(`🖼️ Adding thumbnail to analysis: ${targetVideo.thumbnail_url}`);
    }

    logger.log('Calling Claude Vision API for pattern extraction...');
    const extractionStartTime = Date.now();
    const extractionResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1200,
      temperature: 0.7,
      messages: [{ 
        role: 'user', 
        content: messageContent
      }]
    });
    const extractionDuration = Date.now() - extractionStartTime;

    const content = extractionResponse.content[0];
    if (content.type !== 'text') {
      logger.log('❌ Unexpected response type from Claude', { content });
      throw new Error('Unexpected response type from Claude');
    }

    logger.log(`✅ Claude response received in ${extractionDuration}ms`);
    logger.log('Raw Claude Response:', { 
      response: content.text,
      usage: extractionResponse.usage,
      model: extractionResponse.model 
    });

    let pattern: ExtractedPattern;
    try {
      // More robust JSON extraction and validation
      const responseText = content.text.trim();
      
      // Check for unexpected content contamination
      if (responseText.includes('newsletter') || responseText.includes('unsubscribe') || responseText.includes('deals')) {
        logger.log('⚠️ Possible content contamination detected in Claude response');
        throw new Error('Claude response appears to contain unexpected content');
      }
      
      const jsonMatch = responseText.match(/\{[\s\S]*?\}(?=\s*$|$)/);
      if (!jsonMatch) {
        logger.log('❌ No valid JSON found in Claude response', { responseText });
        throw new Error('No JSON found in response');
      }
      
      pattern = JSON.parse(jsonMatch[0]);
      
      // Validate required fields
      const requiredFields = ['pattern_name', 'semantic_queries', 'key_elements'];
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
    const debugInfo = {
      extraction: {
        promptTokens: Math.round(extractionPrompt.length / 4), // Rough estimate
        responseTokens: Math.round(content.text.length / 4),
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.7,
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
      const { data: videos } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, temporal_performance_score, topic_niche, topic_domain, llm_summary, thumbnail_url')
        .in('id', videoIds)
        .gte('temporal_performance_score', 2.5) // Lowered from 3 to catch more good performers
        .order('temporal_performance_score', { ascending: false })
        .limit(20); // Limit to top 20 for faster LLM validation
      
      logger.log(`📊 Filtered to ${videos?.length || 0} high performers (2.5x+) for validation`);
      debugInfo.searchLogs.push(`📊 Filtered to ${videos?.length || 0} high performers (2.5x+) for validation`);
      
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
          
          const validationPrompt = `Does this video match the "${pattern.pattern_name}" pattern?

Pattern elements: ${pattern.key_elements?.slice(0, 3).join(', ')}
Video: "${video.title}"

Reply with ONLY:
YES: [one sentence why] OR NO: [brief reason]`;

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
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 100,
              temperature: 0.3,
              messages: [{
                role: 'user',
                content: validationContent
              }]
            });

            const validationContent2 = validationResponse.content[0];
            if (validationContent2.type === 'text') {
              const response = validationContent2.text.trim();
              const isYes = response.toUpperCase().startsWith('YES');
              const validationDuration = Date.now() - validationStart;
              
              if (isYes) {
                const parts = response.replace(/^YES:\s*/i, '').split('|');
                const textReason = parts[0]?.trim() || '';
                const visualReason = parts[1]?.replace(/VISUAL:\s*/i, '').trim() || '';
                
                validatedVideos.push({
                  video,
                  isValid: true,
                  reason: textReason,
                  visualMatch: visualReason || undefined,
                  source: matchInfo?.source || 'title'
                });
                
                console.log(`    ✅ "${video.title}" - ${textReason}${visualReason ? ` | Visual: ${visualReason}` : ''}`);
                debugInfo.searchLogs.push(`    ✅ Validated "${video.title.slice(0, 50)}..." in ${validationDuration}ms (${matchInfo?.source || 'unknown'} source)`);
                if (visualReason) {
                  debugInfo.searchLogs.push(`      🎨 Visual match: ${visualReason}`);
                }
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
        published_at: targetVideo.published_at
      },
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