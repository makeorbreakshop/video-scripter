/**
 * Comprehensive thumbnail pattern analysis test
 * Tests CLIP vectors, Vision APIs, and integration with existing pattern analysis
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pineconeService } from '../lib/pinecone-service.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Test 1: Find pattern break using CLIP vectors
async function testClipPatternBreak(videoId) {
  console.log('\n🎯 TEST 1: CLIP VECTOR PATTERN BREAK DETECTION\n');
  
  // Get target video
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single();

  if (!video) {
    console.log('Video not found');
    return;
  }

  console.log(`📹 Analyzing: "${video.title}"`);
  console.log(`📊 Performance: ${video.temporal_performance_score?.toFixed(1)}x\n`);

  // Get channel's typical thumbnails
  const { data: channelVideos } = await supabase
    .from('videos')
    .select('id, title, temporal_performance_score')
    .eq('channel_id', video.channel_id)
    .neq('id', videoId)
    .order('published_at', { ascending: false })
    .limit(20);

  // Get CLIP vector for target video from Pinecone
  try {
    // First, check if we have the vector
    const result = await pineconeService.getVector(videoId, 'thumbnails');
    
    if (result) {
      console.log('✅ Found thumbnail vector in Pinecone');
      
      // Search for similar thumbnails
      const similar = await pineconeService.searchSimilar(
        result.values, // Use the actual vector
        100,
        0.7, // High similarity threshold
        0,
        'thumbnails'
      );

      // Analyze channel consistency
      const channelMatches = similar.results.filter(r => 
        channelVideos?.some(v => v.id === r.video_id)
      );

      const otherChannelMatches = similar.results.filter(r => 
        !channelVideos?.some(v => v.id === r.video_id)
      );

      console.log(`\n📊 PATTERN BREAK ANALYSIS:`);
      console.log(`Channel similarity: ${channelMatches.length}/${channelVideos?.length} videos`);
      console.log(`Visual uniqueness score: ${(1 - channelMatches.length/20).toFixed(2)}`);
      
      // Find high performers with similar style
      const highPerformers = [];
      for (const match of otherChannelMatches.slice(0, 20)) {
        const { data: v } = await supabase
          .from('videos')
          .select('title, channel_name, temporal_performance_score')
          .eq('id', match.video_id)
          .single();
        
        if (v && v.temporal_performance_score > 3) {
          highPerformers.push({
            ...v,
            similarity: match.similarity_score
          });
        }
      }

      if (highPerformers.length > 0) {
        console.log(`\n✨ Similar thumbnails that succeeded elsewhere:`);
        highPerformers.slice(0, 5).forEach(v => {
          console.log(`  - ${v.channel_name}: ${v.temporal_performance_score.toFixed(1)}x (sim: ${v.similarity.toFixed(3)})`);
        });
        
        const successRate = (highPerformers.length / otherChannelMatches.length * 100).toFixed(1);
        console.log(`\n🎯 Success rate: ${successRate}% of similar thumbnails performed >3x`);
      }

      return {
        uniqueness: 1 - channelMatches.length/20,
        successRate: highPerformers.length / otherChannelMatches.length,
        similarHighPerformers: highPerformers
      };
    }
  } catch (error) {
    console.log('Error accessing Pinecone:', error.message);
  }
}

// Test 2: OpenAI Vision API Analysis
async function testOpenAIVision(video) {
  console.log('\n🤖 TEST 2: OPENAI VISION API ANALYSIS\n');
  
  if (!video.thumbnail_url) {
    console.log('No thumbnail URL available');
    return;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `This thumbnail helped a video get ${video.temporal_performance_score?.toFixed(1)}x its channel's average performance.

Analyze what specific visual decisions made this thumbnail stand out:

1. COLOR PSYCHOLOGY: What emotions do the colors evoke?
2. VISUAL HIERARCHY: Where does the eye go first, second, third?
3. CURIOSITY TRIGGERS: What questions does it create?
4. PATTERN BREAKS: What's unusual or unexpected?
5. INFORMATION GAP: What's shown vs hidden?

Rate each aspect 1-10 and explain why.
Then give the #1 most replicable element.`
          },
          {
            type: "image_url",
            image_url: { url: video.thumbnail_url }
          }
        ]
      }],
      max_tokens: 500
    });

    const analysis = response.choices[0].message.content;
    console.log(analysis);
    
    // Extract scores using regex
    const scores = {};
    const scoreMatches = analysis.matchAll(/(\d+)\/10/g);
    for (const match of scoreMatches) {
      scores[match.index] = parseInt(match[1]);
    }
    
    const cost = (response.usage?.prompt_tokens * 0.0025 + response.usage?.completion_tokens * 0.01) / 1000;
    console.log(`\n💰 OpenAI Cost: $${cost.toFixed(4)}`);
    
    return { analysis, scores, cost };
  } catch (error) {
    console.error('OpenAI Vision error:', error.message);
  }
}

// Test 3: Claude Vision API Analysis
async function testClaudeVision(video) {
  console.log('\n🔮 TEST 3: CLAUDE VISION API ANALYSIS\n');
  
  if (!video.thumbnail_url) {
    console.log('No thumbnail URL available');
    return;
  }

  try {
    // Fetch the image and convert to base64
    const imageResponse = await fetch(video.thumbnail_url);
    const buffer = await imageResponse.buffer();
    const base64Image = buffer.toString('base64');
    
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `This thumbnail achieved ${video.temporal_performance_score?.toFixed(1)}x the channel's typical performance.

As an expert in visual psychology and YouTube optimization, identify:

1. The PRIMARY psychological trigger (be specific)
2. The visual "pattern break" from typical YouTube thumbnails
3. The title-thumbnail relationship dynamic
4. Emotional intensity level (1-10)
5. Cognitive load (1-10, lower is better)

Most importantly: What SPECIFIC, REPLICABLE decision can other creators learn from this?`
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          }
        ]
      }]
    });

    const analysis = response.content[0].text;
    console.log(analysis);
    
    // Rough cost estimate (Claude doesn't provide token counts in response)
    const estimatedTokens = analysis.length / 4 + 500; // rough estimate
    const cost = estimatedTokens * 0.003 / 1000; // Claude 3.5 Sonnet pricing
    console.log(`\n💰 Claude Cost (estimate): $${cost.toFixed(4)}`);
    
    return { analysis, cost };
  } catch (error) {
    console.error('Claude Vision error:', error.message);
  }
}

// Test 4: Title-Thumbnail Information Gap Analysis
async function testInformationGap(video) {
  console.log('\n🔍 TEST 4: TITLE-THUMBNAIL INFORMATION GAP\n');
  
  const prompt = `Title: "${video.title}"
Thumbnail: [Analyzing thumbnail at ${video.thumbnail_url}]

Rate these title-thumbnail dynamics (1-10):
1. CURIOSITY GAP: How much does the viewer NEED to click to understand?
2. INFORMATION ASYMMETRY: How is info distributed between title and thumbnail?
3. EMOTIONAL CONTRAST: Difference in emotional tone between title and thumbnail
4. COMPLETION DRIVE: How incomplete is the story without clicking?

Provide specific examples and a total "Click Necessity Score" out of 40.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: video.thumbnail_url } }
        ]
      }],
      max_tokens: 400
    });

    console.log(response.choices[0].message.content);
    
    // Extract total score
    const scoreMatch = response.choices[0].message.content.match(/(\d+)\/40/);
    const totalScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    
    console.log(`\n📊 Click Necessity Score: ${totalScore}/40`);
    return { totalScore, analysis: response.choices[0].message.content };
  } catch (error) {
    console.error('Information gap analysis error:', error.message);
  }
}

// Test 5: Use existing pattern analysis API with thumbnail insights
async function testPatternAPIIntegration(videoId) {
  console.log('\n🔗 TEST 5: PATTERN API INTEGRATION\n');
  
  try {
    // Call your existing pattern analysis API
    const response = await fetch('http://localhost:3000/api/analyze-pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    console.log(`Pattern: "${data.pattern.pattern_name}"`);
    console.log(`Strength: ${data.validation.pattern_strength}`);
    console.log(`Validations: ${data.validation.total_validations} across ${data.validation.results.length} niches\n`);
    
    // Show how thumbnails could enhance this
    console.log('📸 THUMBNAIL ENHANCEMENT OPPORTUNITIES:');
    console.log('1. Add visual similarity validation to strengthen pattern confidence');
    console.log('2. Show thumbnail grid of validated videos for visual proof');
    console.log('3. Highlight visual pattern breaks that correlate with success');
    console.log('4. Calculate "Visual Consistency Score" across validations');
    
    return data;
  } catch (error) {
    console.error('Pattern API error:', error.message);
  }
}

// Main test runner
async function runComprehensiveTest() {
  console.log('🚀 COMPREHENSIVE THUMBNAIL PATTERN ANALYSIS TEST\n');
  console.log('=' .repeat(60));
  
  // Find a high-performing video to test
  const { data: testVideo } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 10)
    .not('thumbnail_url', 'is', null)
    .order('temporal_performance_score', { ascending: false })
    .limit(1)
    .single();

  if (!testVideo) {
    console.log('No suitable test video found');
    return;
  }

  console.log(`\n📹 TEST VIDEO: "${testVideo.title}"`);
  console.log(`📺 Channel: ${testVideo.channel_name}`);
  console.log(`📊 Performance: ${testVideo.temporal_performance_score?.toFixed(1)}x baseline`);
  console.log(`🔗 Video ID: ${testVideo.id}\n`);
  console.log('=' .repeat(60));

  // Run all tests
  const results = {};
  
  // Test 1: CLIP Pattern Break
  results.clipAnalysis = await testClipPatternBreak(testVideo.id);
  
  // Test 2: OpenAI Vision
  results.openaiVision = await testOpenAIVision(testVideo);
  
  // Test 3: Claude Vision
  results.claudeVision = await testClaudeVision(testVideo);
  
  // Test 4: Information Gap
  results.infoGap = await testInformationGap(testVideo);
  
  // Test 5: Pattern API Integration
  results.patternAPI = await testPatternAPIIntegration(testVideo.id);
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 COMPREHENSIVE ANALYSIS SUMMARY\n');
  
  console.log('🎯 KEY INSIGHTS:');
  if (results.clipAnalysis) {
    console.log(`- Visual uniqueness: ${(results.clipAnalysis.uniqueness * 100).toFixed(0)}% different from channel norm`);
    console.log(`- Success rate: ${(results.clipAnalysis.successRate * 100).toFixed(0)}% of similar thumbnails succeed`);
  }
  if (results.infoGap) {
    console.log(`- Click necessity: ${results.infoGap.totalScore}/40`);
  }
  
  console.log('\n💡 ACTIONABLE RECOMMENDATIONS:');
  console.log('1. Add "Visual Pattern Score" combining CLIP similarity + Vision analysis');
  console.log('2. Show thumbnail grid in pattern results for visual validation');
  console.log('3. Highlight specific visual elements that correlate with success');
  console.log('4. Track channel visual evolution to identify successful experiments');
  
  console.log('\n💰 TOTAL COST:');
  const totalCost = (results.openaiVision?.cost || 0) + (results.claudeVision?.cost || 0);
  console.log(`$${totalCost.toFixed(4)} for complete analysis`);
  console.log('(~$0.01-0.02 per video with all vision APIs)');
  
  return results;
}

// Run the test
runComprehensiveTest().catch(console.error);