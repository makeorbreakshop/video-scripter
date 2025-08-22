/**
 * Pattern Analysis API - TEST VERSION WITH SONNET 4
 * POST /api/analyze-pattern-sonnet4
 * 
 * This is a test endpoint to compare Claude Sonnet 4 vs 3.5 performance
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

// Simplified logger for testing
class TestLogger {
  private logs: string[] = [];
  private logFile: string = '';
  
  constructor(videoId: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logDir = '/Users/brandoncullum/video-scripter/logs/sonnet4-test';
    
    // Ensure directory exists
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    this.logFile = path.join(logDir, `sonnet4-test-${videoId}-${timestamp}.log`);
    this.log('='.repeat(80));
    this.log(`SONNET 4 TEST LOG - ${new Date().toISOString()}`);
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
  
  save() {
    const finalLog = this.logs.join('\n') + `\n\n${'='.repeat(80)}\nLOG COMPLETE - ${new Date().toISOString()}\n${'='.repeat(80)}`;
    fs.writeFileSync(this.logFile, finalLog, 'utf8');
    console.log(`📁 Sonnet 4 test log saved: ${this.logFile}`);
    return this.logFile;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id }: AnalyzeRequest = await request.json();
    const logger = new TestLogger(video_id);

    if (!video_id) {
      return NextResponse.json(
        { error: 'video_id is required' },
        { status: 400 }
      );
    }


    // Get target video
    const { data: targetVideo, error: videoError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, temporal_performance_score, channel_baseline_at_publish, topic_niche, topic_domain, thumbnail_url, published_at, channel_id')
      .eq('id', video_id)
      .single();

    if (videoError || !targetVideo) {
      logger.log('❌ Video not found', { video_id, error: videoError });
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    logger.log(`🔍 Testing Sonnet 4 vs 3.5 for video: ${video_id}`);
    logger.log(`📺 Target: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x TPS)`);
    logger.log(`🖼️ Thumbnail: ${targetVideo.thumbnail_url ? 'Available' : 'Missing'}`);

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    // Pattern extraction prompt
    const extractionPrompt = `You are analyzing a viral YouTube video to extract transferable success patterns.

TARGET VIDEO (${targetVideo.temporal_performance_score?.toFixed(1)}x performance):
Title: "${targetVideo.title}"
Views: ${targetVideo.view_count.toLocaleString()}
Channel: ${targetVideo.channel_name}
Niche: ${targetVideo.topic_niche || targetVideo.topic_domain}

Extract the core success pattern and return ONLY a JSON object with these exact fields:
{
  "pattern_name": "Short catchy name for this pattern",
  "pattern_description": "What makes this content successful",
  "psychological_trigger": "Why viewers click and watch",
  "key_elements": ["element1", "element2", "element3"],
  "visual_elements": ["visual1", "visual2"],
  "thumbnail_psychology": "Why the thumbnail works",
  "why_it_works": "Deeper explanation of success factors",
  "semantic_queries": ["query1", "query2", "query3"],
  "visual_queries": ["visual search 1", "visual search 2"]
}

Focus on transferable elements that could work across similar content in this niche.`;

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

    // Test both Sonnet 3.5 and Sonnet 4
    logger.log('\n' + '='.repeat(60));
    logger.log('TESTING SONNET 3.5 (CURRENT)');
    logger.log('='.repeat(60));
    
    const sonnet35Start = Date.now();
    const sonnet35Response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1200,
      temperature: 0.7,
      messages: [{ 
        role: 'user', 
        content: messageContent
      }]
    });
    const sonnet35Duration = Date.now() - sonnet35Start;
    
    // Calculate Sonnet 3.5 costs
    const sonnet35InputTokens = sonnet35Response.usage?.input_tokens || 0;
    const sonnet35OutputTokens = sonnet35Response.usage?.output_tokens || 0;
    const hasVision = !!targetVideo.thumbnail_url;
    const sonnet35InputCost = hasVision ? (sonnet35InputTokens * 3.6 / 1000000) : (sonnet35InputTokens * 3 / 1000000);
    const sonnet35OutputCost = sonnet35OutputTokens * 15 / 1000000;
    const sonnet35Cost = sonnet35InputCost + sonnet35OutputCost;

    logger.log(`⏱️ Sonnet 3.5 completed in ${sonnet35Duration}ms`);
    logger.log(`💰 Sonnet 3.5 cost: $${sonnet35Cost.toFixed(6)} (${sonnet35InputTokens} input + ${sonnet35OutputTokens} output tokens)`);

    const sonnet35Content = sonnet35Response.content[0];
    let sonnet35Pattern = null;
    if (sonnet35Content.type === 'text') {
      try {
        const jsonMatch = sonnet35Content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          sonnet35Pattern = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        logger.log('❌ Failed to parse Sonnet 3.5 JSON response');
      }
    }

    logger.log('\n' + '='.repeat(60));
    logger.log('TESTING SONNET 4 (NEW)');
    logger.log('='.repeat(60));
    
    const sonnet4Start = Date.now();
    const sonnet4Response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',  // Sonnet 4 model identifier
      max_tokens: 1200,
      temperature: 0.7,
      messages: [{ 
        role: 'user', 
        content: messageContent
      }]
    });
    const sonnet4Duration = Date.now() - sonnet4Start;
    
    // Calculate Sonnet 4 costs (different pricing)
    const sonnet4InputTokens = sonnet4Response.usage?.input_tokens || 0;
    const sonnet4OutputTokens = sonnet4Response.usage?.output_tokens || 0;
    // Sonnet 4 pricing: $15 input + $75 output per 1M tokens (estimated)
    const sonnet4InputCost = sonnet4InputTokens * 15 / 1000000;
    const sonnet4OutputCost = sonnet4OutputTokens * 75 / 1000000;
    const sonnet4Cost = sonnet4InputCost + sonnet4OutputCost;

    logger.log(`⏱️ Sonnet 4 completed in ${sonnet4Duration}ms`);
    logger.log(`💰 Sonnet 4 cost: $${sonnet4Cost.toFixed(6)} (${sonnet4InputTokens} input + ${sonnet4OutputTokens} output tokens)`);

    const sonnet4Content = sonnet4Response.content[0];
    let sonnet4Pattern = null;
    if (sonnet4Content.type === 'text') {
      try {
        const jsonMatch = sonnet4Content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          sonnet4Pattern = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        logger.log('❌ Failed to parse Sonnet 4 JSON response');
      }
    }

    // Compare results
    logger.log('\n' + '='.repeat(60));
    logger.log('COMPARISON RESULTS');
    logger.log('='.repeat(60));
    
    const comparison = {
      performance: {
        sonnet35_duration_ms: sonnet35Duration,
        sonnet4_duration_ms: sonnet4Duration,
        speed_difference: `Sonnet 4 is ${((sonnet4Duration / sonnet35Duration - 1) * 100).toFixed(1)}% ${sonnet4Duration > sonnet35Duration ? 'slower' : 'faster'}`
      },
      costs: {
        sonnet35_cost: sonnet35Cost,
        sonnet4_cost: sonnet4Cost,
        cost_multiplier: `${(sonnet4Cost / sonnet35Cost).toFixed(1)}x more expensive`
      },
      output_quality: {
        sonnet35_parsed: !!sonnet35Pattern,
        sonnet4_parsed: !!sonnet4Pattern,
        sonnet35_elements_count: sonnet35Pattern?.key_elements?.length || 0,
        sonnet4_elements_count: sonnet4Pattern?.key_elements?.length || 0,
        sonnet35_queries_count: sonnet35Pattern?.semantic_queries?.length || 0,
        sonnet4_queries_count: sonnet4Pattern?.semantic_queries?.length || 0
      }
    };

    logger.log('Performance Comparison:', comparison);

    if (sonnet35Pattern) {
      logger.log('\nSonnet 3.5 Pattern:', sonnet35Pattern);
    }
    
    if (sonnet4Pattern) {
      logger.log('\nSonnet 4 Pattern:', sonnet4Pattern);
    }

    const finalResults = {
      test_type: 'Sonnet 4 vs 3.5 Pattern Extraction',
      video_id,
      video_title: targetVideo.title,
      comparison,
      sonnet35: {
        pattern: sonnet35Pattern,
        raw_response: sonnet35Content.type === 'text' ? sonnet35Content.text : null,
        tokens: { input: sonnet35InputTokens, output: sonnet35OutputTokens },
        cost: sonnet35Cost,
        duration_ms: sonnet35Duration
      },
      sonnet4: {
        pattern: sonnet4Pattern,
        raw_response: sonnet4Content.type === 'text' ? sonnet4Content.text : null,
        tokens: { input: sonnet4InputTokens, output: sonnet4OutputTokens },
        cost: sonnet4Cost,
        duration_ms: sonnet4Duration
      },
      processing_time_ms: Date.now() - startTime
    };

    // Save the test log
    logger.save();

    return NextResponse.json(finalResults);

  } catch (error) {
    console.error('❌ Sonnet 4 test failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Sonnet 4 test failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}