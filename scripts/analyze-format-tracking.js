#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeFormatTracking() {
  console.log('📊 Analyzing Format Detection Tracking Data\n');
  
  try {
    // Get summary stats
    const { data: summary } = await supabase
      .from('format_detection_feedback')
      .select('llm_was_used');
    
    const total = summary.length;
    const llmUsed = summary.filter(s => s.llm_was_used).length;
    const keywordOnly = total - llmUsed;
    
    console.log(`Total classifications tracked: ${total}`);
    console.log(`Keyword-only classifications: ${keywordOnly} (${(keywordOnly/total*100).toFixed(1)}%)`);
    console.log(`LLM-assisted classifications: ${llmUsed} (${(llmUsed/total*100).toFixed(1)}%)\n`);
    
    // Get disagreements
    const { data: disagreements } = await supabase
      .from('format_detection_feedback')
      .select('*')
      .eq('llm_was_used', true)
      .not('keyword_format', 'is', null)
      .not('llm_format', 'is', null);
    
    const actualDisagreements = disagreements.filter(d => d.keyword_format !== d.llm_format);
    console.log(`\n🔍 Disagreement Analysis:`);
    console.log(`Total LLM corrections: ${actualDisagreements.length} (${(actualDisagreements.length/llmUsed*100).toFixed(1)}% of LLM uses)\n`);
    
    // Count by disagreement type
    const disagreementPatterns = {};
    actualDisagreements.forEach(d => {
      const key = `${d.keyword_format} → ${d.llm_format}`;
      disagreementPatterns[key] = (disagreementPatterns[key] || 0) + 1;
    });
    
    console.log('Most common corrections:');
    Object.entries(disagreementPatterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([pattern, count]) => {
        console.log(`  ${pattern}: ${count} times`);
      });
    
    // Analyze confidence ranges
    console.log('\n📈 Confidence Analysis:');
    const confidenceRanges = {
      'very_low': { min: 0, max: 0.3, keyword: 0, llm: 0 },
      'low': { min: 0.3, max: 0.5, keyword: 0, llm: 0 },
      'medium': { min: 0.5, max: 0.7, keyword: 0, llm: 0 },
      'high': { min: 0.7, max: 0.9, keyword: 0, llm: 0 },
      'very_high': { min: 0.9, max: 1.0, keyword: 0, llm: 0 }
    };
    
    disagreements.forEach(d => {
      for (const [name, range] of Object.entries(confidenceRanges)) {
        if (d.keyword_confidence >= range.min && d.keyword_confidence <= range.max) {
          range.keyword++;
          if (d.keyword_format !== d.llm_format) {
            range.llm++;
          }
        }
      }
    });
    
    console.log('Keyword confidence vs LLM disagreement rate:');
    for (const [name, range] of Object.entries(confidenceRanges)) {
      if (range.keyword > 0) {
        const disagreementRate = (range.llm / range.keyword * 100).toFixed(1);
        console.log(`  ${name} (${range.min}-${range.max}): ${disagreementRate}% disagreement (${range.llm}/${range.keyword})`);
      }
    }
    
    // Find patterns in titles that confuse keywords
    console.log('\n🎯 Common Title Patterns That Need LLM:');
    const confusingTitles = actualDisagreements.slice(0, 10);
    confusingTitles.forEach((d, i) => {
      console.log(`\n${i + 1}. "${d.video_title}"`);
      console.log(`   Keywords thought: ${d.keyword_format} (${d.keyword_confidence})`);
      console.log(`   LLM decided: ${d.llm_format} (${d.llm_confidence})`);
      if (d.keyword_matches) {
        const matches = d.keyword_matches;
        console.log(`   Matched keywords: ${[...matches.strong || [], ...matches.medium || []].join(', ')}`);
      }
    });
    
    // Channel-specific patterns
    console.log('\n📺 Channels with consistent formats:');
    const { data: channelData } = await supabase
      .from('format_detection_feedback')
      .select('channel_name, final_format')
      .not('channel_name', 'is', null);
    
    const channelFormats = {};
    channelData.forEach(d => {
      if (!channelFormats[d.channel_name]) {
        channelFormats[d.channel_name] = {};
      }
      channelFormats[d.channel_name][d.final_format] = 
        (channelFormats[d.channel_name][d.final_format] || 0) + 1;
    });
    
    // Find channels with 80%+ consistency
    Object.entries(channelFormats).forEach(([channel, formats]) => {
      const total = Object.values(formats).reduce((sum, count) => sum + count, 0);
      if (total >= 5) { // Only channels with 5+ videos
        Object.entries(formats).forEach(([format, count]) => {
          const percentage = (count / total * 100);
          if (percentage >= 80) {
            console.log(`  ${channel}: ${format} (${percentage.toFixed(0)}% of ${total} videos)`);
          }
        });
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run analysis
analyzeFormatTracking();