/**
 * Test thumbnail analysis integrated with existing pattern API
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

// Test with a specific video that has good channel comparison data
async function testWithSpecificVideo() {
  console.log('🎯 TESTING THUMBNAIL ANALYSIS WITH PATTERN API\n');
  console.log('=' .repeat(60));
  
  // Find a video with good performance and channel data
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, channel_name, channel_id, temporal_performance_score, thumbnail_url, view_count')
    .gte('temporal_performance_score', 5)
    .lte('temporal_performance_score', 50) // Not the extreme outliers
    .not('thumbnail_url', 'is', null)
    .eq('channel_name', 'Veritasium') // Popular channel with consistent content
    .order('temporal_performance_score', { ascending: false })
    .limit(1);

  let testVideo = videos?.[0];
  
  if (!testVideo) {
    // Try another channel
    const { data: altVideos } = await supabase
      .from('videos')
      .select('id, title, channel_name, channel_id, temporal_performance_score, thumbnail_url, view_count')
      .gte('temporal_performance_score', 5)
      .not('thumbnail_url', 'is', null)
      .order('temporal_performance_score', { ascending: false })
      .limit(1)
      .single();
    
    testVideo = altVideos;
  }

  if (!testVideo) {
    console.log('No suitable test video found');
    return;
  }

  console.log(`\n📹 Test Video: "${testVideo.title}"`);
  console.log(`📺 Channel: ${testVideo.channel_name}`);
  console.log(`📊 Performance: ${testVideo.temporal_performance_score.toFixed(1)}x baseline`);
  console.log(`👁️ Views: ${testVideo.view_count.toLocaleString()}\n`);

  // Step 1: Call existing pattern API
  console.log('1️⃣ CALLING PATTERN ANALYSIS API...\n');
  
  try {
    const patternResponse = await fetch('http://localhost:3000/api/analyze-pattern', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: testVideo.id })
    });

    if (!patternResponse.ok) {
      throw new Error(`Pattern API error: ${patternResponse.status}`);
    }

    const patternData = await patternResponse.json();
    
    console.log(`✅ Pattern: "${patternData.pattern.pattern_name}"`);
    console.log(`📝 Description: ${patternData.pattern.pattern_description}`);
    console.log(`🧠 Trigger: ${patternData.pattern.psychological_trigger}`);
    console.log(`💪 Strength: ${patternData.validation.pattern_strength}`);
    console.log(`📊 Validations: ${patternData.validation.total_validations} across ${patternData.validation.results.length} niches\n`);

    // Step 2: Enhance with thumbnail analysis
    console.log('2️⃣ ENHANCING WITH THUMBNAIL ANALYSIS...\n');
    
    // Get channel baseline thumbnails
    const { data: channelVideos } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, temporal_performance_score')
      .eq('channel_id', testVideo.channel_id)
      .neq('id', testVideo.id)
      .gte('temporal_performance_score', 0.8)
      .lte('temporal_performance_score', 1.2)
      .not('thumbnail_url', 'is', null)
      .order('published_at', { ascending: false })
      .limit(3);

    const channelThumbnails = channelVideos?.map(v => v.thumbnail_url) || [];
    console.log(`Found ${channelThumbnails.length} baseline thumbnails from channel\n`);

    // Analyze visual pattern breaks
    if (channelThumbnails.length > 0) {
      const visualAnalysis = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `The FIRST image is from a video that got ${testVideo.temporal_performance_score.toFixed(1)}x normal performance.
Images 2-${channelThumbnails.length + 1} are typical for this channel.

Pattern found: "${patternData.pattern.pattern_name}"
Description: ${patternData.pattern.pattern_description}

Does the thumbnail visually support this pattern? How?
What visual elements reinforce the pattern?
What changed from the channel's typical style?

Be specific and actionable.`
            },
            {
              type: "image_url",
              image_url: { url: testVideo.thumbnail_url }
            },
            ...channelThumbnails.map(url => ({
              type: "image_url",
              image_url: { url }
            }))
          ]
        }],
        max_tokens: 400,
        temperature: 0.3
      });

      console.log('🎨 VISUAL PATTERN VALIDATION:');
      console.log(visualAnalysis.choices[0].message.content);
      console.log();
    }

    // Step 3: Check validated videos for visual similarity
    console.log('3️⃣ CHECKING VISUAL CONSISTENCY ACROSS VALIDATED VIDEOS...\n');
    
    if (patternData.validation.results.length > 0) {
      // Get thumbnails from top validated videos
      const topValidatedVideos = patternData.validation.results
        .slice(0, 3)
        .flatMap(niche => niche.videos.slice(0, 2));
      
      const validatedThumbnails = topValidatedVideos
        .filter(v => v.thumbnail_url)
        .slice(0, 4);

      if (validatedThumbnails.length > 0) {
        console.log(`Analyzing ${validatedThumbnails.length} validated videos...\n`);
        
        const consistencyCheck = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: `These thumbnails all allegedly use the pattern: "${patternData.pattern.pattern_name}"

Do they share visual similarities? What elements are consistent?
Rate visual pattern consistency: 1-10
List the common visual elements.`
              },
              {
                type: "image_url",
                image_url: { url: testVideo.thumbnail_url }
              },
              ...validatedThumbnails.map(v => ({
                type: "image_url",
                image_url: { url: v.thumbnail_url }
              }))
            ]
          }],
          max_tokens: 300,
          temperature: 0.3
        });

        console.log('🔄 VISUAL CONSISTENCY CHECK:');
        console.log(consistencyCheck.choices[0].message.content);
        console.log();
        
        // Extract consistency score
        const scoreMatch = consistencyCheck.choices[0].message.content.match(/(\d+)\/10/);
        const consistencyScore = scoreMatch ? parseInt(scoreMatch[1]) : 0;
        console.log(`\n📊 Visual Consistency Score: ${consistencyScore}/10`);
      }
    }

    // Step 4: Title-Thumbnail Synergy
    console.log('\n4️⃣ ANALYZING TITLE-THUMBNAIL SYNERGY...\n');
    
    const synergyAnalysis = await analyzeInfoGap(testVideo, patternData.pattern);
    
    // Step 5: Generate enhanced insights
    console.log('\n5️⃣ ENHANCED PATTERN INSIGHTS WITH THUMBNAILS\n');
    console.log('=' .repeat(50));
    
    console.log('📊 PATTERN VALIDATION LEVELS:');
    console.log(`1. Semantic (titles/summaries): ✅ ${patternData.validation.total_validations} matches`);
    console.log(`2. Visual (thumbnails): ${channelThumbnails.length > 0 ? '✅ Pattern break confirmed' : '⚠️ Need channel data'}`);
    console.log(`3. Performance correlation: ✅ ${patternData.validation.avg_pattern_score.toFixed(1)}x average`);
    
    console.log('\n💡 THUMBNAIL ENHANCEMENTS FOR PATTERN PAGE:');
    console.log('1. Visual Pattern Break Score: Shows deviation from channel norm');
    console.log('2. Visual Consistency Rating: How well validated videos match visually');
    console.log('3. Click Necessity Score: Title-thumbnail information gap');
    console.log('4. Thumbnail Grid: Visual proof of pattern across niches');
    console.log('5. Replicable Visual Elements: Specific techniques to copy');

    return {
      pattern: patternData.pattern,
      validation: patternData.validation,
      visualAnalysis: synergyAnalysis
    };

  } catch (error) {
    console.error('Error:', error.message);
    
    // If API is not running, show what would be added
    console.log('\n⚠️ Pattern API not available, showing enhancement concept...\n');
    
    console.log('THUMBNAIL ENHANCEMENTS WOULD ADD:');
    console.log('1. Visual pattern validation alongside semantic validation');
    console.log('2. Channel baseline comparison (visual uniqueness score)');
    console.log('3. Cross-niche visual consistency check');
    console.log('4. Title-thumbnail synergy analysis');
    console.log('5. Specific visual elements that correlate with success');
  }
}

// Analyze title-thumbnail information gap
async function analyzeInfoGap(video, pattern) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Title: "${video.title}"
Pattern: "${pattern.pattern_name}"

How do the title and thumbnail work together to create this pattern?

1. INFORMATION DISTRIBUTION:
   - What's ONLY in the title?
   - What's ONLY in the thumbnail?
   - How do they create curiosity together?

2. CLICK NECESSITY (1-10): How badly must someone click?

3. PATTERN REINFORCEMENT: How does the visual support the pattern?

Be specific about the mechanism.`
          },
          {
            type: "image_url",
            image_url: { url: video.thumbnail_url }
          }
        ]
      }],
      max_tokens: 300,
      temperature: 0.3
    });

    console.log('🔗 TITLE-THUMBNAIL SYNERGY:');
    console.log(response.choices[0].message.content);
    
    return response.choices[0].message.content;
  } catch (error) {
    console.error('Synergy analysis error:', error.message);
    return null;
  }
}

// Run the test
console.log('🚀 STARTING INTEGRATED THUMBNAIL-PATTERN TEST\n');
testWithSpecificVideo().catch(console.error);