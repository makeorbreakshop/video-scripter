#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

import { Anthropic } from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Current approach - one at a time with full prompt
async function classifyWithCurrentApproach(titles) {
  console.log('\n🐢 Testing CURRENT approach (one at a time, full prompt)...\n');
  
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const results = [];
  
  for (const title of titles) {
    const prompt = `You are an AI assistant specialized in categorizing YouTube videos based on their format.

Analyze the following YouTube video title and classify it into ONE of these format categories:

1. tutorial - How-to guides, step-by-step instructions, teaching content
2. product_focus - Reviews, unboxings, product comparisons, buying guides
3. case_study - Real examples, success/failure stories, experiments with results
4. personal_story - Vlogs, personal journeys, life updates, storytimes
5. explainer - Concept explanations, "what is" content, educational breakdowns
6. compilation - Lists, top X videos, best of collections, roundups
7. news_analysis - Current events, industry updates, news commentary

Title: "${title}"

Consider:
- Keywords that strongly indicate format (e.g., "how to" = tutorial)
- The primary intent (teach, review, explain, share story, etc.)
- Don't be fooled by channel names or secondary elements

Respond with a JSON object: {"format": "format_name", "confidence": 0.0-1.0}`;

    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }]
    });
    
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;
    
    try {
      const result = JSON.parse(response.content[0].text);
      results.push({ title, ...result });
    } catch (e) {
      // Extract JSON from response if it includes explanation
      const jsonMatch = response.content[0].text.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        results.push({ title, ...result });
      } else {
        console.error(`Failed to parse response for "${title}":`, response.content[0].text);
        results.push({ title, format: 'unknown', confidence: 0 });
      }
    }
  }
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  return {
    results,
    stats: {
      duration,
      totalInputTokens,
      totalOutputTokens,
      costEstimate: (totalInputTokens * 0.00025 + totalOutputTokens * 0.00125) / 1000
    }
  };
}

// Optimized approach - batch processing with minimal prompt
async function classifyWithOptimizedApproach(titles) {
  console.log('\n🚀 Testing OPTIMIZED approach (batch processing, minimal prompt)...\n');
  
  const startTime = Date.now();
  
  const prompt = `Classify these YouTube titles into formats. Return JSON array.

Formats:
- tutorial: how-to, guide, learn
- product_focus: review, unboxing, comparison
- case_study: results, experiment, success story
- personal_story: vlog, journey, storytime
- explainer: what is, explained, understanding
- compilation: top X, list, best of
- news_analysis: news, update, industry

Titles:
${titles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Return: [{"title": "...", "format": "...", "confidence": 0.0-1.0}, ...]`;

  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });
  
  const endTime = Date.now();
  const duration = (endTime - startTime) / 1000;
  
  const results = JSON.parse(response.content[0].text);
  
  return {
    results,
    stats: {
      duration,
      totalInputTokens: response.usage.input_tokens,
      totalOutputTokens: response.usage.output_tokens,
      costEstimate: (response.usage.input_tokens * 0.00025 + response.usage.output_tokens * 0.00125) / 1000
    }
  };
}

// Get 10 test videos
console.log('📹 Getting 10 test videos...');

const { data: videos } = await supabase
  .from('videos')
  .select('id, title')
  .limit(10);

const titles = videos.map(v => v.title);

console.log('Test videos:');
titles.forEach((t, i) => console.log(`${i + 1}. ${t}`));

// Test both approaches
const currentResults = await classifyWithCurrentApproach(titles);
const optimizedResults = await classifyWithOptimizedApproach(titles);

// Compare results
console.log('\n📊 COMPARISON RESULTS:');
console.log('='.repeat(80));

console.log('\nPERFORMANCE:');
console.log(`Current approach:   ${currentResults.stats.duration.toFixed(2)}s, ${currentResults.stats.totalInputTokens} in / ${currentResults.stats.totalOutputTokens} out tokens, $${currentResults.stats.costEstimate.toFixed(4)}`);
console.log(`Optimized approach: ${optimizedResults.stats.duration.toFixed(2)}s, ${optimizedResults.stats.totalInputTokens} in / ${optimizedResults.stats.totalOutputTokens} out tokens, $${optimizedResults.stats.costEstimate.toFixed(4)}`);

console.log(`\nSPEEDUP: ${(currentResults.stats.duration / optimizedResults.stats.duration).toFixed(1)}x faster`);
console.log(`TOKEN REDUCTION: ${(100 - (optimizedResults.stats.totalInputTokens / currentResults.stats.totalInputTokens) * 100).toFixed(0)}% fewer input tokens`);
console.log(`COST REDUCTION: ${(100 - (optimizedResults.stats.costEstimate / currentResults.stats.costEstimate) * 100).toFixed(0)}% cheaper`);

console.log('\nACCURACY CHECK:');
let matches = 0;
for (let i = 0; i < titles.length; i++) {
  const current = currentResults.results[i];
  const optimized = optimizedResults.results.find(r => r.title === titles[i]);
  
  if (current.format === optimized.format) {
    matches++;
    console.log(`✅ ${i + 1}. Both: ${current.format} (conf: ${current.confidence.toFixed(2)} vs ${optimized.confidence.toFixed(2)})`);
  } else {
    console.log(`❌ ${i + 1}. Differ: ${current.format} vs ${optimized.format}`);
    console.log(`   Title: "${titles[i]}"`);
  }
}

console.log(`\nAGREEMENT RATE: ${(matches / titles.length * 100).toFixed(0)}%`);

// Extrapolate to 65k videos
console.log('\n💰 EXTRAPOLATED TO 65,000 VIDEOS:');
const videosPerBatch = 10;
const batchesNeeded = Math.ceil(65000 / videosPerBatch);

const currentCost65k = currentResults.stats.costEstimate * (65000 / titles.length);
const optimizedCost65k = optimizedResults.stats.costEstimate * batchesNeeded;

console.log(`Current approach:   $${currentCost65k.toFixed(2)} (one at a time)`);
console.log(`Optimized approach: $${optimizedCost65k.toFixed(2)} (batches of ${videosPerBatch})`);
console.log(`SAVINGS: $${(currentCost65k - optimizedCost65k).toFixed(2)} (${(100 - (optimizedCost65k / currentCost65k) * 100).toFixed(0)}% reduction)`);