/**
 * Enhanced Pattern Analysis API - Adds thumbnail/visual analysis to existing system
 * POST /api/analyze-pattern-enhanced
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';

interface AnalyzeRequest {
  video_id: string;
}

interface EnhancedPattern {
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

interface EnhancedValidationResult {
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

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id }: AnalyzeRequest = await request.json();

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

    console.log(`🔍 [Enhanced] Analyzing pattern for video: ${video_id}`);

    // Get target video with baseline information
    const { data: targetVideo, error: videoError } = await supabase
      .from('videos')
      .select('*, channel_baseline_at_publish')
      .eq('id', video_id)
      .single();

    if (videoError || !targetVideo) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    console.log(`📺 Target: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x TPS)`);
    console.log(`🖼️ Thumbnail: ${targetVideo.thumbnail_url ? 'Available' : 'Missing'}`);

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

    console.log(`📊 Found ${baselineVideos?.length || 0} baseline videos for comparison`);

    // Enhanced Step 1: Extract pattern using Claude with vision
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
      console.log(`🖼️ Adding thumbnail to analysis: ${targetVideo.thumbnail_url}`);
    }

    const extractionResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1200,
      temperature: 0.7,
      messages: [{ 
        role: 'user', 
        content: messageContent
      }]
    });

    const content = extractionResponse.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let pattern: EnhancedPattern;
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      pattern = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse pattern extraction');
    }

    console.log(`✅ Pattern extracted: ${pattern.pattern_name}`);
    console.log(`📝 Text queries: ${pattern.semantic_queries?.join(', ')}`);
    console.log(`🎨 Visual queries: ${pattern.visual_queries?.join(', ') || 'None'}`);
    
    // Enhanced Step 2: Multi-modal validation using semantic + visual search
    const validationResults: EnhancedValidationResult[] = [];
    const openaiKey = process.env.OPENAI_API_KEY!;
    
    // Track all unique videos found across searches
    const allFoundVideos = new Map<string, { 
      video_id: string, 
      similarity_score: number, 
      source: 'title' | 'summary' | 'thumbnail',
      query: string 
    }>();
    
    // Step 2a: Text-based semantic search (existing logic)
    console.log(`🔎 Starting text-based semantic searches...`);
    for (const query of pattern.semantic_queries || []) {
      console.log(`  Searching text for: "${query}"`);
      
      // Generate embedding for the query
      const queryEmbedding = await generateQueryEmbedding(query, openaiKey);
      
      // Search both title and summary namespaces
      const [titleResults, summaryResults] = await Promise.all([
        pineconeService.searchSimilar(queryEmbedding, 20, 0.5, 0, undefined),
        pineconeService.searchSimilar(queryEmbedding, 20, 0.4, 0, 'llm-summaries')
      ]);
      
      console.log(`    Title search: ${titleResults.results.length} results`);
      console.log(`    Summary search: ${summaryResults.results.length} results`);
      
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
    }
    
    // Step 2b: Visual-based search using thumbnail embeddings
    console.log(`🎨 Starting visual-based thumbnail searches...`);
    for (const visualQuery of pattern.visual_queries || []) {
      console.log(`  Searching thumbnails for: "${visualQuery}"`);
      
      try {
        // Generate embedding for visual query
        const visualEmbedding = await generateQueryEmbedding(visualQuery, openaiKey);
        
        // Search thumbnail namespace
        const thumbnailResults = await pineconeService.searchSimilar(
          visualEmbedding, 
          15, 
          0.6, 
          0, 
          'thumbnails'
        );
        
        console.log(`    Thumbnail search: ${thumbnailResults.results.length} results`);
        
        // Add thumbnail results with higher weight for visual matches
        thumbnailResults.results.forEach(r => {
          const existing = allFoundVideos.get(r.video_id);
          const visualWeight = r.similarity_score * 1.3; // Weight visual matches higher
          if (!existing || existing.similarity_score < visualWeight) {
            allFoundVideos.set(r.video_id, {
              video_id: r.video_id,
              similarity_score: visualWeight,
              source: 'thumbnail',
              query: visualQuery
            });
          }
        });
      } catch (error) {
        console.warn(`⚠️ Visual search failed for "${visualQuery}":`, error);
      }
    }
    
    console.log(`📊 Total unique videos found: ${allFoundVideos.size} across all searches`);
      
    // Step 3: Get full video data and enhanced LLM validation
    if (allFoundVideos.size > 0) {
      const videoIds = Array.from(allFoundVideos.keys());
      
      // Get full video data with performance scores and thumbnails
      const { data: videos } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, temporal_performance_score, topic_niche, topic_domain, llm_summary, thumbnail_url')
        .in('id', videoIds)
        .gte('temporal_performance_score', 2.5)
        .order('temporal_performance_score', { ascending: false })
        .limit(15); // Smaller batch for enhanced validation
      
      console.log(`📊 Filtered to ${videos?.length || 0} high performers (2.5x+) for validation`);
      
      // Step 4: Enhanced LLM validation with visual analysis
      const validatedVideos: Array<{
        video: typeof videos[0],
        isValid: boolean,
        reason: string,
        visualMatch?: string,
        source: 'title' | 'summary' | 'thumbnail'
      }> = [];
      
      if (videos && videos.length > 0) {
        console.log(`🤖 Starting enhanced LLM validation for ${videos.length} videos...`);
        
        // Process videos individually for better visual analysis
        for (const video of videos) {
          const matchInfo = allFoundVideos.get(video.id);
          
          const validationPrompt = `Analyze if this video matches the discovered pattern:

PATTERN TO MATCH:
Name: "${pattern.pattern_name}"
Text Elements: ${pattern.key_elements?.join(', ')}
Visual Elements: ${pattern.visual_elements?.join(', ') || 'None specified'}
Thumbnail Psychology: ${pattern.thumbnail_psychology || 'Not analyzed'}

VIDEO TO VALIDATE:
Title: "${video.title}"
Channel: ${video.channel_name}
Performance: ${video.temporal_performance_score?.toFixed(1)}x
Found via: ${matchInfo?.source || 'unknown'} search

Does this video match the pattern? Consider both text and visual elements if thumbnail is provided.

Reply format:
- If YES: "YES: [text match reason] | VISUAL: [visual match reason if applicable]"  
- If NO: "NO"`;

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
              max_tokens: 300,
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
              }
            }
          } catch (error) {
            console.warn(`⚠️ Validation failed for video ${video.id}:`, error);
          }
        }
        
        console.log(`✅ Enhanced validation complete: ${validatedVideos.length} videos confirmed`);
        
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
    
    const patternStrength = totalValidations >= 10 && avgPatternScore >= 5 ? 'strong' :
                           totalValidations >= 5 && avgPatternScore >= 3 ? 'moderate' : 'weak';

    const processingTime = Date.now() - startTime;
    console.log(`✅ Enhanced pattern analysis complete in ${processingTime}ms`);
    console.log(`📊 Found ${totalValidations} validations (${visualValidations} with visual matches) across ${validationResults.length} niches`);

    return NextResponse.json({
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
        thumbnail_analysis_enabled: !!targetVideo.thumbnail_url
      }
    });

  } catch (error) {
    console.error('❌ Enhanced pattern analysis failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze pattern (enhanced)',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}