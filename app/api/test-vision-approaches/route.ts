/**
 * Vision Approaches Test API
 * Tests different vision analysis approaches from Claude cookbook
 * POST /api/test-vision-approaches
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

interface TestRequest {
  video_id: string;
  approaches?: string[]; // Which approaches to test
}

// Vision approaches to test
const VISION_APPROACHES = {
  basic: 'Basic thumbnail analysis',
  structured: 'Structured vision prompting with explicit sections',
  multi_agent: 'Multi-agent analysis (composition + psychology + branding)',
  progressive: 'Progressive analysis (overview → details → insights)',
  error_resilient: 'Error-resilient with fallback strategies'
};

class VisionTestLogger {
  private logs: string[] = [];
  private logFile: string = '';
  
  constructor(videoId: string) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logDir = '/Users/brandoncullum/video-scripter/logs/vision-test';
    
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    this.logFile = path.join(logDir, `vision-test-${videoId}-${timestamp}.log`);
    this.log('='.repeat(80));
    this.log(`VISION APPROACHES TEST - ${new Date().toISOString()}`);
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
    console.log(`📁 Vision test log saved: ${this.logFile}`);
    return this.logFile;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id, approaches = ['basic', 'structured', 'multi_agent'] }: TestRequest = await request.json();
    const logger = new VisionTestLogger(video_id);

    if (!video_id) {
      return NextResponse.json(
        { error: 'video_id is required' },
        { status: 400 }
      );
    }


    // Get target video
    const { data: targetVideo, error: videoError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, temporal_performance_score, thumbnail_url, topic_niche, topic_domain')
      .eq('id', video_id)
      .single();

    if (videoError || !targetVideo || !targetVideo.thumbnail_url) {
      logger.log('❌ Video not found or no thumbnail', { video_id, error: videoError });
      return NextResponse.json(
        { error: 'Video not found or no thumbnail available' },
        { status: 404 }
      );
    }

    logger.log(`🔍 Testing vision approaches for: ${video_id}`);
    logger.log(`📺 Target: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x TPS)`);
    logger.log(`🖼️ Thumbnail: ${targetVideo.thumbnail_url}`);
    logger.log(`🧪 Testing approaches: ${approaches.join(', ')}`);

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const results: any = {};

    // Test Basic Approach
    if (approaches.includes('basic')) {
      logger.log('\n' + '='.repeat(60));
      logger.log('TESTING: BASIC APPROACH');
      logger.log('='.repeat(60));
      
      const basicStart = Date.now();
      const basicPrompt = `Analyze this YouTube thumbnail and explain why it might be successful for a video about "${targetVideo.title}". Focus on visual elements and psychology.`;
      
      const basicResponse = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: basicPrompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: targetVideo.thumbnail_url
              }
            }
          ]
        }]
      });
      
      const basicDuration = Date.now() - basicStart;
      const basicContent = basicResponse.content[0];
      
      results.basic = {
        duration_ms: basicDuration,
        tokens: { input: basicResponse.usage?.input_tokens || 0, output: basicResponse.usage?.output_tokens || 0 },
        response: basicContent.type === 'text' ? basicContent.text : null
      };
      
      logger.log(`⏱️ Basic completed in ${basicDuration}ms`);
      logger.log(`📝 Response length: ${results.basic.response?.length || 0} chars`);
    }

    // Test Structured Approach
    if (approaches.includes('structured')) {
      logger.log('\n' + '='.repeat(60));
      logger.log('TESTING: STRUCTURED VISION PROMPTING');
      logger.log('='.repeat(60));
      
      const structuredStart = Date.now();
      const structuredPrompt = `Analyze this YouTube thumbnail using the following structured approach:

## VISUAL COMPOSITION ANALYSIS
- Layout and positioning of elements
- Color scheme and contrast
- Typography and text placement
- Visual hierarchy and focus points

## PSYCHOLOGICAL TRIGGERS
- Emotional response the thumbnail evokes
- Curiosity gaps or intrigue elements
- Authority/credibility signals
- Urgency or FOMO indicators

## BRANDING ELEMENTS
- Channel branding consistency
- Professional vs casual presentation
- Target audience alignment
- Niche-specific visual cues

## PERFORMANCE PREDICTION
- Likely click-through rate factors
- Thumbnail effectiveness score (1-10)
- Comparison to typical thumbnails in this niche
- Specific improvements that could boost performance

Provide detailed analysis for each section. This is for a video titled: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x performance vs channel baseline).`;
      
      const structuredResponse = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: structuredPrompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: targetVideo.thumbnail_url
              }
            }
          ]
        }]
      });
      
      const structuredDuration = Date.now() - structuredStart;
      const structuredContent = structuredResponse.content[0];
      
      results.structured = {
        duration_ms: structuredDuration,
        tokens: { input: structuredResponse.usage?.input_tokens || 0, output: structuredResponse.usage?.output_tokens || 0 },
        response: structuredContent.type === 'text' ? structuredContent.text : null
      };
      
      logger.log(`⏱️ Structured completed in ${structuredDuration}ms`);
      logger.log(`📝 Response length: ${results.structured.response?.length || 0} chars`);
    }

    // Test Multi-Agent Approach
    if (approaches.includes('multi_agent')) {
      logger.log('\n' + '='.repeat(60));
      logger.log('TESTING: MULTI-AGENT VISION ANALYSIS');
      logger.log('='.repeat(60));
      
      const multiAgentStart = Date.now();
      const multiAgentPrompt = `You are a team of three specialized analysts examining this YouTube thumbnail. Each analyst should provide their expert perspective:

**DESIGN ANALYST**: Focus on visual composition, color theory, typography, layout principles, and aesthetic appeal. Rate the design quality and identify specific design choices that impact performance.

**PSYCHOLOGY ANALYST**: Focus on emotional triggers, cognitive biases, viewer psychology, curiosity gaps, and behavioral responses. Explain why viewers would click based on psychological principles.

**MARKETING ANALYST**: Focus on positioning, competitive differentiation, target audience alignment, trend awareness, and market positioning. Compare to successful thumbnails in this niche.

Each analyst should:
1. Provide their specialized analysis
2. Give a confidence score (1-10) for their assessment
3. Identify the top 3 elements that support or hurt click-through rates
4. Suggest 1-2 specific improvements from their domain expertise

Video context: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x performance, ${targetVideo.channel_name}, ${targetVideo.topic_niche || targetVideo.topic_domain} niche)

Format your response with clear headers for each analyst.`;
      
      const multiAgentResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514', // Use Sonnet 4 for complex multi-agent analysis
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: multiAgentPrompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: targetVideo.thumbnail_url
              }
            }
          ]
        }]
      });
      
      const multiAgentDuration = Date.now() - multiAgentStart;
      const multiAgentContent = multiAgentResponse.content[0];
      
      results.multi_agent = {
        duration_ms: multiAgentDuration,
        tokens: { input: multiAgentResponse.usage?.input_tokens || 0, output: multiAgentResponse.usage?.output_tokens || 0 },
        response: multiAgentContent.type === 'text' ? multiAgentContent.text : null,
        model_used: 'claude-sonnet-4-20250514'
      };
      
      logger.log(`⏱️ Multi-agent completed in ${multiAgentDuration}ms`);
      logger.log(`📝 Response length: ${results.multi_agent.response?.length || 0} chars`);
    }

    // Test Progressive Analysis
    if (approaches.includes('progressive')) {
      logger.log('\n' + '='.repeat(60));
      logger.log('TESTING: PROGRESSIVE VISION ANALYSIS');
      logger.log('='.repeat(60));
      
      const progressiveStart = Date.now();
      
      // Step 1: Overview
      const overviewPrompt = `First, provide a high-level overview of this thumbnail in 2-3 sentences. What's the main visual story?`;
      
      const overviewResponse = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: overviewPrompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: targetVideo.thumbnail_url
              }
            }
          ]
        }]
      });
      
      const overview = overviewResponse.content[0].type === 'text' ? overviewResponse.content[0].text : '';
      
      // Step 2: Detailed Analysis
      const detailPrompt = `Based on this overview: "${overview}"

Now provide detailed analysis of specific elements:
1. Text elements (font, size, placement, readability)
2. Visual elements (objects, people, backgrounds)
3. Color choices and their psychological impact
4. Compositional techniques used

Video context: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x performance)`;
      
      const detailResponse = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: detailPrompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: targetVideo.thumbnail_url
              }
            }
          ]
        }]
      });
      
      const detailAnalysis = detailResponse.content[0].type === 'text' ? detailResponse.content[0].text : '';
      
      // Step 3: Strategic Insights
      const insightPrompt = `Based on the overview: "${overview}"

And detailed analysis: "${detailAnalysis}"

Now provide strategic insights:
1. Why this thumbnail likely outperforms (${targetVideo.temporal_performance_score?.toFixed(1)}x baseline)
2. Key success patterns that could be replicated
3. Specific psychological triggers being activated
4. How this compares to typical ${targetVideo.topic_niche || targetVideo.topic_domain} thumbnails
5. 3 actionable recommendations for similar thumbnails`;
      
      const insightResponse = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: insightPrompt },
            {
              type: 'image',
              source: {
                type: 'url',
                url: targetVideo.thumbnail_url
              }
            }
          ]
        }]
      });
      
      const strategicInsights = insightResponse.content[0].type === 'text' ? insightResponse.content[0].text : '';
      
      const progressiveDuration = Date.now() - progressiveStart;
      const totalTokens = (overviewResponse.usage?.input_tokens || 0) + (overviewResponse.usage?.output_tokens || 0) +
                         (detailResponse.usage?.input_tokens || 0) + (detailResponse.usage?.output_tokens || 0) +
                         (insightResponse.usage?.input_tokens || 0) + (insightResponse.usage?.output_tokens || 0);
      
      results.progressive = {
        duration_ms: progressiveDuration,
        tokens: { total: totalTokens },
        steps: {
          overview,
          detail_analysis: detailAnalysis,
          strategic_insights: strategicInsights
        },
        response: `## OVERVIEW\n${overview}\n\n## DETAILED ANALYSIS\n${detailAnalysis}\n\n## STRATEGIC INSIGHTS\n${strategicInsights}`
      };
      
      logger.log(`⏱️ Progressive completed in ${progressiveDuration}ms (3 steps)`);
      logger.log(`📝 Total response length: ${results.progressive.response?.length || 0} chars`);
    }

    // Test Error-Resilient Approach
    if (approaches.includes('error_resilient')) {
      logger.log('\n' + '='.repeat(60));
      logger.log('TESTING: ERROR-RESILIENT PROCESSING');
      logger.log('='.repeat(60));
      
      const resilientStart = Date.now();
      
      // Primary attempt with detailed analysis
      let resilientResult: any = { attempts: [] };
      
      try {
        const primaryPrompt = `Analyze this thumbnail comprehensively. If you cannot see specific details clearly, focus on what you can observe and note any limitations.

Provide analysis in this exact JSON structure:
{
  "visual_clarity": "high|medium|low",
  "main_elements": ["element1", "element2"],
  "color_scheme": ["color1", "color2"],
  "text_elements": ["text1", "text2"],
  "psychological_triggers": ["trigger1", "trigger2"],
  "effectiveness_score": 8.5,
  "confidence_level": "high|medium|low",
  "limitations_noted": ["limitation1", "limitation2"]
}

Video: "${targetVideo.title}" (${targetVideo.temporal_performance_score?.toFixed(1)}x performance)`;
        
        const primaryResponse = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 800,
          temperature: 0.3, // Lower temperature for more consistent JSON
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: primaryPrompt },
              {
                type: 'image',
                source: {
                  type: 'url',
                  url: targetVideo.thumbnail_url
                }
              }
            ]
          }]
        });
        
        resilientResult.attempts.push({
          type: 'primary',
          success: true,
          response: primaryResponse.content[0].type === 'text' ? primaryResponse.content[0].text : null,
          tokens: { input: primaryResponse.usage?.input_tokens || 0, output: primaryResponse.usage?.output_tokens || 0 }
        });
        
      } catch (error) {
        resilientResult.attempts.push({
          type: 'primary',
          success: false,
          error: String(error)
        });
        
        // Fallback to basic analysis
        try {
          const fallbackResponse = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 400,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Describe this thumbnail in simple terms.' },
                {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: targetVideo.thumbnail_url
                  }
                }
              ]
            }]
          });
          
          resilientResult.attempts.push({
            type: 'fallback',
            success: true,
            response: fallbackResponse.content[0].type === 'text' ? fallbackResponse.content[0].text : null,
            tokens: { input: fallbackResponse.usage?.input_tokens || 0, output: fallbackResponse.usage?.output_tokens || 0 }
          });
          
        } catch (fallbackError) {
          resilientResult.attempts.push({
            type: 'fallback',
            success: false,
            error: String(fallbackError)
          });
        }
      }
      
      const resilientDuration = Date.now() - resilientStart;
      resilientResult.duration_ms = resilientDuration;
      resilientResult.final_response = resilientResult.attempts.find(a => a.success)?.response || 'All attempts failed';
      
      results.error_resilient = resilientResult;
      
      logger.log(`⏱️ Error-resilient completed in ${resilientDuration}ms`);
      logger.log(`📝 Attempts: ${resilientResult.attempts.length}, Successful: ${resilientResult.attempts.filter(a => a.success).length}`);
    }

    // Log comparison results
    logger.log('\n' + '='.repeat(60));
    logger.log('COMPARISON RESULTS');
    logger.log('='.repeat(60));
    
    const comparison = {
      approaches_tested: approaches,
      performance: Object.keys(results).map(approach => ({
        approach,
        duration_ms: results[approach].duration_ms,
        response_length: results[approach].response?.length || 0,
        tokens_used: results[approach].tokens?.total || (results[approach].tokens?.input + results[approach].tokens?.output) || 0
      })),
      total_processing_time: Date.now() - startTime
    };
    
    logger.log('Performance comparison:', comparison);

    // Log quality assessment
    logger.log('\n📊 QUALITY ASSESSMENT:');
    approaches.forEach(approach => {
      if (results[approach]?.response) {
        const response = results[approach].response;
        const wordCount = response.split(' ').length;
        const hasStructure = response.includes('##') || response.includes('**') || response.includes('1.');
        const hasSpecifics = /\b(color|font|text|element|trigger|psychology)\b/i.test(response);
        
        logger.log(`${approach.toUpperCase()}:`);
        logger.log(`- Word count: ${wordCount}`);
        logger.log(`- Has structure: ${hasStructure}`);
        logger.log(`- Has specifics: ${hasSpecifics}`);
        logger.log(`- Preview: ${response.substring(0, 150)}...`);
      }
    });

    const finalResults = {
      test_type: 'Vision Approaches Comparison',
      video_id,
      video_title: targetVideo.title,
      video_performance: targetVideo.temporal_performance_score,
      thumbnail_url: targetVideo.thumbnail_url,
      approaches_tested: approaches,
      results,
      comparison,
      processing_time_ms: Date.now() - startTime
    };

    logger.save();

    return NextResponse.json(finalResults);

  } catch (error) {
    console.error('❌ Vision test failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Vision test failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}