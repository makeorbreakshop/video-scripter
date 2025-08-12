/**
 * Test Vision API analysis for thumbnails
 * Demonstrates what insights we could extract with visual analysis
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
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

async function analyzeThumbnailWithVision(videoId, channelId) {
  console.log('\n=== VISION API THUMBNAIL ANALYSIS ===\n');

  // 1. Get the target video and recent channel videos
  const { data: targetVideo } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single();

  const { data: channelVideos } = await supabase
    .from('videos')
    .select('id, title, thumbnail_url, temporal_performance_score, published_at')
    .eq('channel_id', channelId)
    .neq('id', videoId)
    .order('published_at', { ascending: false })
    .limit(20);

  if (!targetVideo || !channelVideos) {
    console.error('Could not fetch video data');
    return;
  }

  console.log(`📹 Target Video: "${targetVideo.title}"`);
  console.log(`📊 Performance: ${targetVideo.temporal_performance_score?.toFixed(1)}x`);
  console.log(`📺 Channel: ${targetVideo.channel_name}\n`);

  // 2. Analyze with GPT-4 Vision (or GPT-5 when available)
  console.log('🤖 VISION API ANALYSIS:\n');

  try {
    const visionPrompt = `Analyze this YouTube thumbnail and explain why it might have gone viral.

Consider:
1. Emotional impact (faces, expressions)
2. Visual composition (colors, contrast, layout)
3. Text elements (size, placement, message)
4. Curiosity triggers (what questions does it create?)
5. Visual hooks (what grabs attention first?)
6. Professional quality score (1-10)

Provide specific, actionable insights about what makes this thumbnail effective.

Also rate these aspects 1-10:
- Emotional intensity
- Visual contrast
- Curiosity gap
- Professional quality
- Clickability`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // or "gpt-5" when available
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: visionPrompt },
            { type: "image_url", image_url: { url: targetVideo.thumbnail_url } }
          ]
        }
      ],
      max_tokens: 500
    });

    console.log('Vision API Analysis:');
    console.log(response.choices[0].message.content);
    console.log();

    // 3. Compare to channel baseline (analyze multiple thumbnails)
    console.log('📊 CHANNEL THUMBNAIL PATTERN ANALYSIS:\n');

    const channelAnalysisPrompt = `Compare these thumbnails from the same YouTube channel.
    
The first image is a viral video (${targetVideo.temporal_performance_score?.toFixed(1)}x performance).
The other images are typical channel videos.

Identify:
1. What visual elements changed in the viral thumbnail?
2. What stayed consistent with the channel's style?
3. What specific deviation likely contributed to virality?
4. Rate the "pattern break" intensity 1-10

Be specific about colors, composition, text, and emotional elements.`;

    // For demo purposes, we'll analyze the first 3 channel videos
    // In production, you'd want to analyze more
    const channelThumbnails = channelVideos.slice(0, 3).map(v => ({
      type: "image_url",
      image_url: { url: v.thumbnail_url }
    }));

    if (channelThumbnails.length > 0) {
      const comparisonResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: channelAnalysisPrompt },
              { type: "image_url", image_url: { url: targetVideo.thumbnail_url } },
              ...channelThumbnails
            ]
          }
        ],
        max_tokens: 500
      });

      console.log('Channel Comparison:');
      console.log(comparisonResponse.choices[0].message.content);
    }

  } catch (error) {
    console.error('Vision API error:', error);
  }

  // 4. Pattern validation with similar viral videos
  console.log('\n🔍 CROSS-NICHE VISUAL VALIDATION:\n');

  // Get other high-performing videos
  const { data: viralVideos } = await supabase
    .from('videos')
    .select('id, title, thumbnail_url, channel_name, temporal_performance_score')
    .gte('temporal_performance_score', 5)
    .neq('channel_id', channelId)
    .limit(5);

  if (viralVideos && viralVideos.length > 0) {
    console.log('Comparing to other viral thumbnails:');
    
    const patternPrompt = `Analyze these viral YouTube thumbnails.

Identify common visual patterns that make them successful:
1. Shared emotional elements
2. Similar composition techniques
3. Common color strategies
4. Recurring visual hooks

What universal principles can creators learn from these?`;

    try {
      const viralThumbnails = viralVideos.map(v => ({
        type: "image_url",
        image_url: { url: v.thumbnail_url }
      }));

      const patternResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: patternPrompt },
              ...viralThumbnails
            ]
          }
        ],
        max_tokens: 500
      });

      console.log('Cross-Niche Pattern Analysis:');
      console.log(patternResponse.choices[0].message.content);

    } catch (error) {
      console.error('Pattern analysis error:', error);
    }
  }

  // 5. Generate actionable insights
  console.log('\n💡 ACTIONABLE INSIGHTS:\n');

  const insightPrompt = `Based on this viral thumbnail analysis, provide 5 specific, actionable recommendations for creators wanting to replicate this success.

Format as:
1. [Specific action]: [Why it works]
2. [Specific action]: [Why it works]
etc.

Focus on replicable elements, not luck or timing.`;

  try {
    const insightResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: insightPrompt },
            { type: "image_url", image_url: { url: targetVideo.thumbnail_url } }
          ]
        }
      ],
      max_tokens: 300
    });

    console.log(insightResponse.choices[0].message.content);

  } catch (error) {
    console.error('Insight generation error:', error);
  }
}

// Combined analysis using both CLIP vectors and Vision API
async function comprehensiveAnalysis(videoId) {
  console.log('\n' + '='.repeat(80));
  console.log('COMPREHENSIVE THUMBNAIL ANALYSIS');
  console.log('='.repeat(80) + '\n');

  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single();

  if (!video) {
    console.error('Video not found');
    return;
  }

  // 1. CLIP Vector Insights (what we can do now)
  console.log('📊 CLIP VECTOR INSIGHTS (Available Now):\n');
  console.log('• Find visually similar thumbnails across all videos');
  console.log('• Identify which visual patterns correlate with high performance');
  console.log('• Track channel visual evolution over time');
  console.log('• Measure visual uniqueness score');
  console.log('• Cross-niche visual pattern validation\n');

  // 2. Vision API Insights (what we could add)
  console.log('🤖 VISION API INSIGHTS (Potential Addition):\n');
  console.log('• Emotional intensity scoring (faces, expressions)');
  console.log('• Text extraction and analysis');
  console.log('• Color psychology and contrast measurement');
  console.log('• Composition and visual hierarchy analysis');
  console.log('• Specific curiosity triggers identification');
  console.log('• Professional quality assessment\n');

  // 3. Combined Power
  console.log('🚀 COMBINED INSIGHTS (CLIP + Vision):\n');
  console.log('• "This thumbnail is 3.2x more emotionally intense than channel average"');
  console.log('• "Red color scheme appears in 78% of viral videos in this niche"');
  console.log('• "Shocked face + simple object pattern validates across 15 niches"');
  console.log('• "Text contradiction technique increases CTR by estimated 40%"');
  console.log('• "First time using this visual style in 100 videos"');

  // Run actual analysis
  await analyzeThumbnailWithVision(videoId, video.channel_id);
}

// Test different scenarios
async function runTests() {
  console.log('🚀 STARTING VISION API THUMBNAIL TESTS\n');
  
  // Get a sample of high-performing videos to test
  const { data: testVideos } = await supabase
    .from('videos')
    .select('id, title, channel_id, temporal_performance_score')
    .gte('temporal_performance_score', 4)
    .limit(1);

  if (testVideos && testVideos.length > 0) {
    for (const video of testVideos) {
      await comprehensiveAnalysis(video.id);
    }
  } else {
    console.log('No high-performing videos found for testing');
  }
}

// Run the tests
runTests().catch(console.error);