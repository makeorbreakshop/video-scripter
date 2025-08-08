/**
 * Pattern Analysis API - Extracts patterns and validates across niches
 * POST /api/analyze-pattern
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';

interface AnalyzeRequest {
  video_id: string;
}

interface ExtractedPattern {
  pattern_name: string;
  pattern_description: string;
  psychological_trigger: string;
  key_elements: string[];
  why_it_works: string;
  semantic_queries: string[];
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
    source?: 'title' | 'summary';
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

    console.log(`🔍 Analyzing pattern for video: ${video_id}`);

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

    // Get 5 baseline videos from same channel (normal performers)
    const { data: baselineVideos } = await supabase
      .from('videos')
      .select('title, view_count, temporal_performance_score, llm_summary')
      .eq('channel_id', targetVideo.channel_id)
      .gte('temporal_performance_score', 0.8)
      .lte('temporal_performance_score', 1.2)
      .neq('id', video_id)
      .order('published_at', { ascending: false })
      .limit(5);

    // Step 1: Extract pattern using Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const extractionPrompt = `You are analyzing a viral YouTube video to extract transferable success patterns and generate search queries.

TARGET VIDEO (${targetVideo.temporal_performance_score.toFixed(1)}x performance):
Title: "${targetVideo.title}"
Views: ${targetVideo.view_count.toLocaleString()}
Channel: ${targetVideo.channel_name}
Niche: ${targetVideo.topic_niche || targetVideo.topic_domain}
${targetVideo.llm_summary ? `Summary: ${targetVideo.llm_summary}` : ''}

CHANNEL BASELINE (normal performers):
${(baselineVideos || []).map((v, i) => 
  `${i + 1}. "${v.title}" - ${v.view_count.toLocaleString()} views (${v.temporal_performance_score.toFixed(1)}x)`
).join('\n')}

Analyze what makes the target video different. Then create 3-5 semantic search queries that would find videos using similar patterns in OTHER niches.

For example, if the pattern is "human achieving machine-like precision", queries might be:
- "perfect precision human vs robot"
- "achieving computer accuracy"
- "machine-like performance"

Return a JSON object:
{
  "pattern_name": "Short, memorable name",
  "pattern_description": "What makes this pattern work",
  "psychological_trigger": "Core human psychology it taps into",
  "key_elements": ["Element 1", "Element 2"],
  "why_it_works": "Why this drives engagement",
  "semantic_queries": ["query 1", "query 2", "query 3"]
}`;

    const extractionResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      temperature: 0.7,
      messages: [{ role: 'user', content: extractionPrompt }]
    });

    const content = extractionResponse.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let pattern: ExtractedPattern;
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      pattern = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse pattern extraction');
    }

    console.log(`✅ Pattern extracted: ${pattern.pattern_name}`);
    console.log(`🔍 Semantic queries: ${pattern.semantic_queries.join(', ')}`);

    // Step 2: Validate pattern using multi-namespace semantic search
    const validationResults: ValidationResult[] = [];
    const openaiKey = process.env.OPENAI_API_KEY!;
    
    // Track all unique videos found across searches
    const allFoundVideos = new Map<string, { 
      video_id: string, 
      similarity_score: number, 
      source: 'title' | 'summary',
      query: string 
    }>();
    
    // Search for each semantic query
    for (const query of pattern.semantic_queries) {
      console.log(`🔎 Searching for: "${query}"`);
      
      // Generate embedding for the query
      const queryEmbedding = await generateQueryEmbedding(query, openaiKey);
      
      // Search both title and summary namespaces in parallel
      const [titleResults, summaryResults] = await Promise.all([
        // Search title embeddings (default namespace)
        pineconeService.searchSimilar(
          queryEmbedding,
          30,  // Get more results for better validation
          0.5, // Lowered threshold - semantic similarity scores typically range 0.5-0.8
          0,
          undefined  // Default namespace for titles
        ),
        // Search summary embeddings
        pineconeService.searchSimilar(
          queryEmbedding,
          30,
          0.4, // Slightly lower threshold for summaries as they capture concepts better
          0,
          'llm-summaries'  // Summary namespace
        )
      ]);
      
      console.log(`   Title search: ${titleResults.results.length} videos (avg sim: ${(titleResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / Math.max(1, titleResults.results.length)).toFixed(3)})`);
      console.log(`   Summary search: ${summaryResults.results.length} videos (avg sim: ${(summaryResults.results.reduce((sum, r) => sum + r.similarity_score, 0) / Math.max(1, summaryResults.results.length)).toFixed(3)})`);
      
      // Merge results with weighted scores (summary matches weighted higher)
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
        const weightedScore = r.similarity_score * 1.2; // Weight summary matches 20% higher
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
    
    console.log(`📊 Total unique videos found: ${allFoundVideos.size} across all searches`);
      
    // Step 3: Get full video data and validate with LLM
    if (allFoundVideos.size > 0) {
      const videoIds = Array.from(allFoundVideos.keys());
      
      // Get full video data with performance scores and summaries
      const { data: videos } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, temporal_performance_score, topic_niche, topic_domain, llm_summary, thumbnail_url')
        .in('id', videoIds)
        .gte('temporal_performance_score', 2.5) // Lowered from 3 to catch more good performers
        .order('temporal_performance_score', { ascending: false })
        .limit(20); // Limit to top 20 for faster LLM validation
      
      console.log(`📊 Filtered to ${videos?.length || 0} high performers (2.5x+) for validation`);
      
      // Step 4: LLM validation for each video
      const validatedVideos: Array<{
        video: typeof videos[0],
        isValid: boolean,
        reason: string,
        source: 'title' | 'summary'
      }> = [];
      
      if (videos && videos.length > 0) {
        console.log(`🤖 Starting LLM validation for ${videos.length} videos...`);
        
        // Batch process videos in groups of 5 for efficiency
        const batchSize = 5;
        for (let i = 0; i < videos.length; i += batchSize) {
          const batch = videos.slice(i, i + batchSize);
          
          // Create validation prompts for the batch
          const validationPrompts = batch.map(video => {
            const matchInfo = allFoundVideos.get(video.id);
            return `
Video: "${video.title}"
Channel: ${video.channel_name}
Summary: ${video.llm_summary ? video.llm_summary.slice(0, 200) + '...' : 'No summary available'}

Does this video demonstrate the pattern "${pattern.pattern_name}" - ${pattern.pattern_description}?

Reply with ONLY: YES:[one sentence reason] or NO
Example: YES: Shows human achieving robot-like precision in chess`;
          });
          
          // Send batch to Claude for validation
          const batchValidationResponse = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 500,
            temperature: 0.3,
            messages: [{
              role: 'user',
              content: `Validate if these videos match the pattern. For each video, respond with YES:[reason] or NO on a new line:\n\n${validationPrompts.join('\n\n---\n\n')}`
            }]
          });
          
          const batchContent = batchValidationResponse.content[0];
          if (batchContent.type === 'text') {
            const responses = batchContent.text.split('\n').filter(line => line.trim());
            
            batch.forEach((video, idx) => {
              const response = responses[idx] || 'NO';
              const isYes = response.toUpperCase().startsWith('YES');
              const reason = isYes ? response.replace(/^YES:\s*/i, '') : '';
              const matchInfo = allFoundVideos.get(video.id);
              
              if (isYes) {
                validatedVideos.push({
                  video,
                  isValid: true,
                  reason,
                  source: matchInfo?.source || 'title'
                });
              }
            });
          }
        }
        
        console.log(`✅ LLM validated ${validatedVideos.length} videos as matching the pattern`);
        
        // Group validated videos by niche
        const nicheGroups: Record<string, typeof validatedVideos> = {};
        validatedVideos.forEach(({ video, reason, source }) => {
          const niche = video.topic_niche || video.topic_domain || 'Unknown';
          if (!nicheGroups[niche]) nicheGroups[niche] = [];
          nicheGroups[niche].push({ video, isValid: true, reason, source });
        });
        
        // Build validation results with reasons
        Object.entries(nicheGroups).forEach(([niche, validatedVids]) => {
          validationResults.push({
            niche,
            videos: validatedVids.slice(0, 5).map(v => ({
              title: v.video.title,
              score: v.video.temporal_performance_score,
              views: v.video.view_count,
              channel: v.video.channel_name,
              thumbnail_url: v.video.thumbnail_url,
              validation_reason: v.reason,
              source: v.source
            })),
            avg_score: validatedVids.reduce((sum, v) => sum + v.video.temporal_performance_score, 0) / validatedVids.length,
            count: validatedVids.length
          });
        });
      }
    }
    
    // Sort validation results by average score
    validationResults.sort((a, b) => b.avg_score - a.avg_score);
    
    // Calculate pattern strength
    const totalValidations = validationResults.reduce((sum, r) => sum + r.count, 0);
    const avgPatternScore = validationResults.length > 0
      ? validationResults.reduce((sum, r) => sum + r.avg_score, 0) / validationResults.length
      : 0;
    
    const patternStrength = totalValidations >= 10 && avgPatternScore >= 5 ? 'strong' :
                           totalValidations >= 5 && avgPatternScore >= 3 ? 'moderate' : 'weak';

    const processingTime = Date.now() - startTime;
    console.log(`✅ Pattern analysis complete in ${processingTime}ms`);
    console.log(`📊 Found ${totalValidations} validations across ${validationResults.length} niches`);

    return NextResponse.json({
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
        results: validationResults.slice(0, 10), // Top 10 niches
        total_validations: totalValidations,
        pattern_strength: patternStrength,
        avg_pattern_score: avgPatternScore
      },
      processing_time_ms: processingTime
    });

  } catch (error) {
    console.error('❌ Pattern analysis failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze pattern',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}