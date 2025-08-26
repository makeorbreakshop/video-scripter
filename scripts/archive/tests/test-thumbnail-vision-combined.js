/**
 * Test combining Vision APIs with existing pattern analysis
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

// Find high-performing videos with pattern breaks
async function findTestVideos() {
  console.log('🔍 Finding test videos with strong pattern breaks...\n');
  
  // Get videos that massively outperformed their channel
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, channel_name, channel_id, temporal_performance_score, thumbnail_url, view_count')
    .gte('temporal_performance_score', 10)
    .not('thumbnail_url', 'is', null)
    .order('temporal_performance_score', { ascending: false })
    .limit(3);

  if (!videos || videos.length === 0) {
    console.log('No suitable videos found, trying lower threshold...');
    const { data: fallback } = await supabase
      .from('videos')
      .select('id, title, channel_name, channel_id, temporal_performance_score, thumbnail_url, view_count')
      .gte('temporal_performance_score', 5)
      .not('thumbnail_url', 'is', null)
      .order('temporal_performance_score', { ascending: false })
      .limit(3);
    return fallback || [];
  }

  return videos;
}

// Test OpenAI Vision for pattern breaks
async function analyzeWithOpenAI(video, channelThumbnails) {
  console.log('\n🤖 OpenAI GPT-4o Vision Analysis');
  console.log('=' .repeat(50));
  
  const startTime = Date.now();
  
  try {
    // First analyze the outlier thumbnail
    const outlierResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `This thumbnail achieved ${video.temporal_performance_score.toFixed(1)}x the channel's normal performance.
Title: "${video.title}"

Analyze:
1. PRIMARY visual hook (what grabs attention first)
2. Emotional triggers (specific emotions evoked)
3. Curiosity mechanisms (what questions it creates)
4. Color psychology (how colors drive clicks)
5. Information gap with title (what's shown vs hidden)

Rate each 1-10 and explain briefly.`
          },
          {
            type: "image_url",
            image_url: { url: video.thumbnail_url }
          }
        ]
      }],
      max_tokens: 400,
      temperature: 0.3
    });

    const outlierAnalysis = outlierResponse.choices[0].message.content;
    console.log('\n📊 Outlier Analysis:');
    console.log(outlierAnalysis);

    // Now compare with channel norms if we have them
    if (channelThumbnails && channelThumbnails.length > 0) {
      const comparisonPrompt = {
        role: "user",
        content: [
          {
            type: "text",
            text: `Image 1 is the OUTLIER (${video.temporal_performance_score.toFixed(1)}x performance).
Images 2-${channelThumbnails.length + 1} are TYPICAL for this channel.

What SPECIFIC visual decisions made the outlier different? Focus on:
- Color/contrast changes
- Composition differences  
- Emotional intensity changes
- New visual elements

Be specific about what changed.`
          },
          {
            type: "image_url",
            image_url: { url: video.thumbnail_url }
          },
          ...channelThumbnails.map(url => ({
            type: "image_url",
            image_url: { url }
          }))
        ]
      };

      const comparisonResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [comparisonPrompt],
        max_tokens: 300,
        temperature: 0.3
      });

      console.log('\n🔄 Pattern Break Analysis:');
      console.log(comparisonResponse.choices[0].message.content);

      const totalTokens = (outlierResponse.usage?.total_tokens || 0) + (comparisonResponse.usage?.total_tokens || 0);
      const cost = (outlierResponse.usage?.prompt_tokens || 0) * 0.0025 / 1000 + 
                   (outlierResponse.usage?.completion_tokens || 0) * 0.01 / 1000 +
                   (comparisonResponse.usage?.prompt_tokens || 0) * 0.0025 / 1000 +
                   (comparisonResponse.usage?.completion_tokens || 0) * 0.01 / 1000;
      
      console.log(`\n💰 OpenAI Cost: $${cost.toFixed(4)} (${totalTokens} tokens)`);
      console.log(`⏱️ Time: ${Date.now() - startTime}ms`);

      return { outlierAnalysis, patternBreak: comparisonResponse.choices[0].message.content, cost };
    }

    const cost = (outlierResponse.usage?.prompt_tokens || 0) * 0.0025 / 1000 + 
                 (outlierResponse.usage?.completion_tokens || 0) * 0.01 / 1000;
    console.log(`\n💰 OpenAI Cost: $${cost.toFixed(4)}`);
    console.log(`⏱️ Time: ${Date.now() - startTime}ms`);

    return { outlierAnalysis, cost };
  } catch (error) {
    console.error('OpenAI error:', error.message);
    return null;
  }
}

// Test Claude Vision for deeper insights
async function analyzeWithClaude(video, channelThumbnails) {
  console.log('\n🔮 Claude 3.5 Sonnet Vision Analysis');
  console.log('=' .repeat(50));
  
  const startTime = Date.now();
  
  try {
    // Fetch thumbnail and convert to base64
    const imageResponse = await fetch(video.thumbnail_url);
    const buffer = await imageResponse.buffer();
    const base64Image = buffer.toString('base64');

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 600,
      temperature: 0.3,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `You're analyzing why this thumbnail achieved ${video.temporal_performance_score.toFixed(1)}x the channel's typical performance.

Video Title: "${video.title}"
Channel: ${video.channel_name}
Views: ${video.view_count.toLocaleString()}

As an expert in visual psychology and viral content, identify:

1. The CORE psychological pattern (not generic like "curiosity" - be specific about WHAT TYPE of curiosity and HOW it's triggered)

2. The title-thumbnail SYNERGY:
   - What info is in the title but NOT the thumbnail?
   - What's in the thumbnail but NOT the title?
   - How do they create an incomplete story together?

3. The REPLICABLE formula (what could other creators copy):
   - Specific visual techniques used
   - Composition decisions
   - Color psychology choices

4. Pattern confidence (1-10): How likely is this pattern to work in other niches?

Focus on ACTIONABLE insights, not observations.`
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageResponse.headers.get('content-type') || 'image/jpeg',
              data: base64Image
            }
          }
        ]
      }]
    });

    const analysis = response.content[0].text;
    console.log('\n📊 Deep Pattern Analysis:');
    console.log(analysis);

    // Extract pattern confidence score
    const confidenceMatch = analysis.match(/confidence[:\s]+(\d+)/i);
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 0;
    
    // Estimate cost (Claude doesn't provide token counts)
    const estimatedTokens = (analysis.length / 4) + 600;
    const cost = estimatedTokens * 0.003 / 1000;
    
    console.log(`\n🎯 Pattern Confidence: ${confidence}/10`);
    console.log(`💰 Claude Cost (estimate): $${cost.toFixed(4)}`);
    console.log(`⏱️ Time: ${Date.now() - startTime}ms`);

    return { analysis, confidence, cost };
  } catch (error) {
    console.error('Claude error:', error.message);
    return null;
  }
}

// Test title-thumbnail information gap
async function analyzeInformationGap(video) {
  console.log('\n📐 Title-Thumbnail Information Gap Analysis');
  console.log('=' .repeat(50));
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Title: "${video.title}"

Analyze the title-thumbnail relationship:

1. CURIOSITY GAP (1-10): How badly does someone NEED to click to understand?
2. INFORMATION DISTRIBUTION: 
   - Key info ONLY in title: [list]
   - Key info ONLY in thumbnail: [list]
   - Overlapping info: [list]
3. STORY COMPLETION (1-10): How incomplete is the story without clicking?
4. CONTRADICTION LEVEL (1-10): Do title and thumbnail contradict/create tension?

Give a TOTAL CLICK NECESSITY SCORE (out of 30) and explain the mechanism.`
          },
          {
            type: "image_url",
            image_url: { url: video.thumbnail_url }
          }
        ]
      }],
      max_tokens: 350,
      temperature: 0.3
    });

    const analysis = response.choices[0].message.content;
    console.log(analysis);

    // Extract scores
    const scoreMatch = analysis.match(/(\d+)\/30/);
    const clickScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;
    
    console.log(`\n🎯 Click Necessity: ${clickScore}/30`);
    
    return { analysis, clickScore };
  } catch (error) {
    console.error('Information gap error:', error.message);
    return null;
  }
}

// Compare both vision APIs
async function compareVisionAPIs(video) {
  console.log('\n🔬 Vision API Comparison');
  console.log('=' .repeat(50));
  
  // Get channel thumbnails for context
  const { data: channelVideos } = await supabase
    .from('videos')
    .select('thumbnail_url')
    .eq('channel_id', video.channel_id)
    .neq('id', video.id)
    .gte('temporal_performance_score', 0.8)
    .lte('temporal_performance_score', 1.2)
    .not('thumbnail_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(3);

  const channelThumbnails = channelVideos?.map(v => v.thumbnail_url) || [];
  
  console.log(`\n📹 Analyzing: "${video.title}"`);
  console.log(`📊 Performance: ${video.temporal_performance_score.toFixed(1)}x`);
  console.log(`📺 Channel: ${video.channel_name}`);
  console.log(`🔗 Comparing with ${channelThumbnails.length} typical channel thumbnails\n`);

  // Run both analyses
  const [openaiResult, claudeResult, infoGap] = await Promise.all([
    analyzeWithOpenAI(video, channelThumbnails),
    analyzeWithClaude(video, channelThumbnails),
    analyzeInformationGap(video)
  ]);

  // Summary comparison
  console.log('\n' + '=' .repeat(50));
  console.log('📊 COMPARISON SUMMARY\n');
  
  console.log('🤖 OpenAI GPT-4o:');
  console.log(`- Cost: $${openaiResult?.cost?.toFixed(4) || 'N/A'}`);
  console.log('- Best for: Visual element identification, quick analysis');
  console.log('- Strength: Consistent scoring, good pattern recognition');
  
  console.log('\n🔮 Claude 3.5 Sonnet:');
  console.log(`- Cost: $${claudeResult?.cost?.toFixed(4) || 'N/A'}`);
  console.log(`- Pattern Confidence: ${claudeResult?.confidence || 'N/A'}/10`);
  console.log('- Best for: Deep psychological insights, replicable formulas');
  console.log('- Strength: Actionable insights, pattern transferability');
  
  console.log('\n📐 Information Gap:');
  console.log(`- Click Necessity: ${infoGap?.clickScore || 'N/A'}/30`);
  console.log('- Key insight: Title-thumbnail synergy creates incomplete story');
  
  const totalCost = (openaiResult?.cost || 0) + (claudeResult?.cost || 0);
  console.log(`\n💰 Total Cost: $${totalCost.toFixed(4)} for complete analysis`);
  
  return {
    video,
    openai: openaiResult,
    claude: claudeResult,
    infoGap,
    totalCost
  };
}

// Main test runner
async function runVisionTests() {
  console.log('🚀 THUMBNAIL VISION API COMPARISON TEST\n');
  console.log('Testing OpenAI GPT-4o vs Claude 3.5 Sonnet for thumbnail analysis');
  console.log('=' .repeat(60) + '\n');

  // Find test videos
  const testVideos = await findTestVideos();
  
  if (testVideos.length === 0) {
    console.log('No suitable test videos found');
    return;
  }

  console.log(`Found ${testVideos.length} test videos:\n`);
  testVideos.forEach((v, i) => {
    console.log(`${i + 1}. "${v.title}" (${v.temporal_performance_score.toFixed(1)}x)`);
  });

  // Test the top performer
  const topVideo = testVideos[0];
  const results = await compareVisionAPIs(topVideo);
  
  // Generate actionable insights
  console.log('\n' + '=' .repeat(60));
  console.log('💡 ACTIONABLE INSIGHTS FOR PATTERN PAGE\n');
  
  console.log('1. Add "Visual Pattern Confidence" score (Claude\'s pattern confidence)');
  console.log('2. Add "Click Necessity Score" (information gap metric)');
  console.log('3. Show "Pattern Break Elements" (what changed from channel norm)');
  console.log('4. Include "Replicable Formula" section (specific techniques to copy)');
  console.log('5. Add thumbnail comparison grid (outlier vs typical)');
  
  console.log('\n🎯 RECOMMENDED APPROACH:');
  console.log('- Use Claude for initial pattern extraction (deeper insights)');
  console.log('- Use OpenAI for batch validation (faster, cheaper)');
  console.log('- Always calculate information gap (strong success predictor)');
  console.log('- Only analyze top 10% performers to manage costs');
  
  return results;
}

// Run the tests
runVisionTests().catch(console.error);