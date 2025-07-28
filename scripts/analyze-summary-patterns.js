#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SUMMARY_PROMPT = `Extract ONLY the actual video content from this YouTube description. 

Ignore ALL of these:
- Affiliate links, product links, gear lists
- Sponsorship messages and discount codes  
- Social media links (Instagram, Twitter, etc)
- Channel promotions and "subscribe" messages
- Timestamps/chapters
- Credits, music attributions
- Patreon/membership calls

Output a 1-2 sentence summary of what the video actually teaches, shows, or discusses. Focus on the core content only.`;

async function generateSummary(video) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: SUMMARY_PROMPT
        },
        {
          role: 'user',
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 1000) || 'No description'}`
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`Error for video ${video.id}:`, error.message);
    return null;
  }
}

async function analyzeSummaryPatterns() {
  console.log('📊 Analyzing Summary Patterns for Clustering\n');
  
  // Get diverse sample
  const { data: allVideos } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .not('description', 'is', null)
    .limit(500);
  
  // Filter for substantial descriptions
  const videos = allVideos?.filter(v => v.description && v.description.length >= 200)
    .slice(0, 50) || [];
  
  if (!videos || videos.length === 0) {
    console.error('No videos found');
    return;
  }
  
  console.log(`Processing ${videos.length} videos...\n`);
  
  const results = [];
  
  // Generate summaries
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const summary = await generateSummary(video);
    
    if (summary) {
      results.push({
        title: video.title,
        summary: summary,
        firstWords: summary.split(' ').slice(0, 3).join(' ').toLowerCase()
      });
    }
    
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log('='.repeat(80));
  console.log('TITLE → SUMMARY EXAMPLES:\n');
  
  // Show first 20 examples
  results.slice(0, 20).forEach((r, i) => {
    console.log(`${i+1}. TITLE: "${r.title}"`);
    console.log(`   SUMMARY: "${r.summary}"`);
    console.log();
  });
  
  // Analyze starting patterns
  console.log('\n' + '='.repeat(80));
  console.log('📈 SUMMARY STARTING PATTERNS:\n');
  
  const startingPatterns = {};
  results.forEach(r => {
    const pattern = r.firstWords;
    startingPatterns[pattern] = (startingPatterns[pattern] || 0) + 1;
  });
  
  // Sort by frequency
  const sortedPatterns = Object.entries(startingPatterns)
    .sort((a, b) => b[1] - a[1]);
  
  console.log('Most common starting phrases:');
  sortedPatterns.slice(0, 15).forEach(([pattern, count]) => {
    const percentage = (count / results.length * 100).toFixed(1);
    console.log(`  "${pattern}..." - ${count} times (${percentage}%)`);
  });
  
  // Count specific patterns
  const videoStarts = results.filter(r => r.summary.toLowerCase().startsWith('the video'));
  const thisVideoStarts = results.filter(r => r.summary.toLowerCase().startsWith('this video'));
  const inThisStarts = results.filter(r => r.summary.toLowerCase().startsWith('in this video'));
  
  console.log('\n📊 PROBLEMATIC PATTERNS:');
  console.log(`  "The video..." - ${videoStarts.length} (${(videoStarts.length/results.length*100).toFixed(1)}%)`);
  console.log(`  "This video..." - ${thisVideoStarts.length} (${(thisVideoStarts.length/results.length*100).toFixed(1)}%)`);
  console.log(`  "In this video..." - ${inThisStarts.length} (${(inThisStarts.length/results.length*100).toFixed(1)}%)`);
  console.log(`  TOTAL with video mentions: ${videoStarts.length + thisVideoStarts.length + inThisStarts.length} (${((videoStarts.length + thisVideoStarts.length + inThisStarts.length)/results.length*100).toFixed(1)}%)`);
  
  // Extract unique content words (removing common starting phrases)
  console.log('\n🎯 CLUSTERING IMPLICATIONS:\n');
  
  console.log('If we use these summaries as-is for BERTopic:');
  console.log('❌ High weight on "the video", "this video", "in this video"');
  console.log('❌ Clusters might form around HOW content is presented rather than WHAT');
  console.log('❌ Similar videos might be separated due to different intro phrases');
  
  console.log('\n💡 BETTER APPROACH - Strip common patterns and focus on content:');
  
  // Show what summaries look like with patterns removed
  console.log('\nEXAMPLES WITH PATTERNS REMOVED:\n');
  
  results.slice(0, 10).forEach((r, i) => {
    let cleaned = r.summary;
    // Remove common starting patterns
    cleaned = cleaned.replace(/^(The video|This video|In this video)\s+(demonstrates?|showcases?|discusses?|teaches?|provides?|features?|highlights?|explores?|covers?|shows?)\s+/i, '');
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    
    console.log(`${i+1}. ORIGINAL: "${r.summary}"`);
    console.log(`   CLEANED: "${cleaned}"`);
    console.log();
  });
  
  // Save results
  await fs.writeFile(
    'summary_pattern_analysis.json',
    JSON.stringify({
      samples: results,
      patterns: sortedPatterns,
      statistics: {
        total: results.length,
        startsWithTheVideo: videoStarts.length,
        startsWithThisVideo: thisVideoStarts.length,
        startsWithInThisVideo: inThisStarts.length
      }
    }, null, 2)
  );
}

analyzeSummaryPatterns().catch(console.error);