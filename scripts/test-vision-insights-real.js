/**
 * Real Vision API test with actual thumbnail analysis
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeRealThumbnail() {
  console.log('\n=== REAL VISION API THUMBNAIL ANALYSIS ===\n');

  // Get the Becca Farsace video that performed 23x
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .eq('id', '0GPig4eGOyQ')
    .single();

  if (!video) {
    console.log('Video not found, searching for any high performer...');
    const { data: anyVideo } = await supabase
      .from('videos')
      .select('*')
      .gte('temporal_performance_score', 10)
      .not('thumbnail_url', 'is', null)
      .limit(1)
      .single();
    
    if (anyVideo) {
      video = anyVideo;
    } else {
      console.log('No high performers found');
      return;
    }
  }

  console.log(`📹 Analyzing: "${video.title}"`);
  console.log(`📺 Channel: ${video.channel_name}`);
  console.log(`📊 Performance: ${video.temporal_performance_score?.toFixed(1)}x`);
  console.log(`🖼️ Thumbnail: ${video.thumbnail_url}\n`);

  // 1. Single thumbnail analysis
  console.log('🤖 VISION ANALYSIS - Why This Thumbnail Worked:\n');

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this YouTube thumbnail and explain why it likely went viral (${video.temporal_performance_score?.toFixed(1)}x channel average).

Rate these aspects 1-10 and explain:
1. Emotional intensity (face expression, body language)
2. Visual contrast (colors, brightness)
3. Curiosity gap (what questions does it create?)
4. Text impact (if present)
5. Professional quality

Then provide the TOP 3 reasons this thumbnail succeeds.

Be specific and actionable.`
            },
            {
              type: "image_url",
              image_url: { url: video.thumbnail_url }
            }
          ]
        }
      ],
      max_tokens: 400
    });

    console.log(response.choices[0].message.content);
    console.log('\n' + '='.repeat(50) + '\n');

    // Calculate token cost
    const promptTokens = response.usage?.prompt_tokens || 0;
    const completionTokens = response.usage?.completion_tokens || 0;
    const cost = (promptTokens * 0.0025 + completionTokens * 0.01) / 1000;
    console.log(`💰 Cost: $${cost.toFixed(4)} (${promptTokens} prompt + ${completionTokens} completion tokens)\n`);

  } catch (error) {
    console.error('Vision API error:', error.message);
  }

  // 2. Get channel's recent thumbnails for comparison
  console.log('📊 CHANNEL COMPARISON ANALYSIS:\n');

  const { data: channelVideos } = await supabase
    .from('videos')
    .select('id, title, thumbnail_url, temporal_performance_score')
    .eq('channel_id', video.channel_id)
    .neq('id', video.id)
    .order('published_at', { ascending: false })
    .limit(3);

  if (channelVideos && channelVideos.length > 0) {
    try {
      const thumbnailUrls = [video.thumbnail_url, ...channelVideos.map(v => v.thumbnail_url)];
      
      const comparisonResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `The FIRST thumbnail went viral (${video.temporal_performance_score?.toFixed(1)}x performance).
The other thumbnails are typical for this channel.

What SPECIFIC visual changes made the first one stand out?
1. Color/contrast changes
2. Emotional intensity changes
3. Composition changes
4. Text/element changes

Be very specific about what changed.`
              },
              ...thumbnailUrls.map(url => ({
                type: "image_url",
                image_url: { url }
              }))
            ]
          }
        ],
        max_tokens: 300
      });

      console.log('Channel Pattern Break Analysis:');
      console.log(comparisonResponse.choices[0].message.content);
      console.log('\n' + '='.repeat(50) + '\n');

      const cost2 = (comparisonResponse.usage?.prompt_tokens || 0) * 0.0025 / 1000 + 
                    (comparisonResponse.usage?.completion_tokens || 0) * 0.01 / 1000;
      console.log(`💰 Cost: $${cost2.toFixed(4)}\n`);

    } catch (error) {
      console.error('Comparison error:', error.message);
    }
  }

  // 3. Actionable insights
  console.log('💡 KEY INSIGHTS FOR YOUR PATTERN PAGE:\n');
  
  console.log('Based on this analysis, you could add:');
  console.log('1. Visual Intensity Score: [from emotion rating]');
  console.log('2. Curiosity Gap Score: [from analysis]');
  console.log('3. Pattern Break Elements: [specific changes from channel norm]');
  console.log('4. Replicable Elements: [what others can copy]');
  console.log('\nThis provides the "WHY" behind the success!');
}

// Run the analysis
analyzeRealThumbnail().catch(console.error);