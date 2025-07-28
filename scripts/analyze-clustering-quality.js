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

// The improved prompt
const ACTION_FIRST_PROMPT = `Analyze this YouTube description and extract only the core content, ignoring all promotional material.

Describe what happens or what is taught in 1-2 sentences. Start with an action verb or noun phrase. Never mention "video", "tutorial", or similar meta-references.

Focus purely on the content itself - the techniques, materials, concepts, and outcomes.`;

async function generateSummary(video) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: ACTION_FIRST_PROMPT
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

function cleanDescription(description) {
  if (!description) return '';
  
  let cleaned = description;
  
  // Remove URLs
  cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, '');
  
  // Remove social media handles
  cleaned = cleaned.replace(/@[\w]+/g, '');
  
  // Remove common promotional phrases
  const promoPatterns = [
    /Subscribe to .+?[\.\!\n]/gi,
    /Follow me on .+?[\.\!\n]/gi,
    /Check out .+?[\.\!\n]/gi,
    /Use code .+?[\.\!\n]/gi,
    /Get \d+% off .+?[\.\!\n]/gi,
    /Link in .+?[\.\!\n]/gi,
  ];
  
  promoPatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Remove timestamps
  cleaned = cleaned.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, '');
  
  // Clean up
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned.substring(0, 500);
}

async function analyzeClusteringQuality() {
  console.log('🔬 Deep Analysis: Title+Description vs LLM Summaries\n');
  
  // Get videos from specific categories to see clustering quality
  const testCategories = [
    { channels: ['Steve Ramsey - Woodworking for Mere Mortals', '731 Woodworks', 'DIY Woodworking Projects'], category: 'Woodworking' },
    { channels: ['3D Printing Nerd', 'Frankly Built', 'Make Anything'], category: '3D Printing' },
    { channels: ['Home RenoVision DIY', 'Everyday Home Repairs'], category: 'Home Improvement' },
    { channels: ['Amy Darley', 'CleanMySpace'], category: 'Cleaning/Organization' }
  ];
  
  const allVideos = [];
  
  for (const cat of testCategories) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, description, channel_name')
      .in('channel_name', cat.channels)
      .not('description', 'is', null)
      .limit(20);
    
    if (videos) {
      allVideos.push(...videos.map(v => ({ ...v, expectedCategory: cat.category })));
    }
  }
  
  console.log(`📊 Analyzing ${allVideos.length} videos from ${testCategories.length} categories\n`);
  
  // Process each video
  const results = [];
  
  for (const video of allVideos.slice(0, 40)) {
    // Method 1: Title + Cleaned Description
    const cleanedDesc = cleanDescription(video.description);
    const titleDescCombo = `${video.title}. ${cleanedDesc}`;
    
    // Method 2: LLM Summary
    const summary = await generateSummary(video);
    
    results.push({
      title: video.title,
      channel: video.channel_name,
      expectedCategory: video.expectedCategory,
      titleDescCombo: titleDescCombo.substring(0, 200),
      llmSummary: summary,
      descriptionPreview: video.description.substring(0, 200)
    });
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Display comparisons by category
  console.log('📋 CONTENT COMPARISON BY CATEGORY:\n');
  
  for (const category of testCategories) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🏷️  ${category.category.toUpperCase()}`);
    console.log(`${'='.repeat(80)}\n`);
    
    const catVideos = results.filter(r => r.expectedCategory === category.category).slice(0, 5);
    
    catVideos.forEach((video, i) => {
      console.log(`${i+1}. "${video.title}"`);
      console.log(`   Channel: ${video.channel}\n`);
      
      console.log(`   📄 ORIGINAL DESCRIPTION (preview):`);
      console.log(`   "${video.descriptionPreview}..."\n`);
      
      console.log(`   🔧 TITLE + CLEANED DESC:`);
      console.log(`   "${video.titleDescCombo}..."\n`);
      
      console.log(`   🤖 LLM SUMMARY:`);
      console.log(`   "${video.llmSummary}"\n`);
      
      console.log(`   ${'-'.repeat(70)}\n`);
    });
  }
  
  // Analyze semantic richness
  console.log('\n📊 SEMANTIC RICHNESS ANALYSIS:\n');
  
  // Count unique technical terms in each approach
  const titleDescTerms = new Set();
  const llmTerms = new Set();
  
  // Technical terms to look for
  const technicalPatterns = [
    /\b(router|saw|drill|sand|glue|joint|mortise|tenon|dovetail|plywood|hardwood)\b/gi,
    /\b(3D print|filament|PLA|ABS|PETG|nozzle|bed level|slicer|STL|layer)\b/gi,
    /\b(drywall|stud|electrical|plumbing|insulation|framing|tile|grout)\b/gi,
    /\b(organize|declutter|storage|shelf|container|label|system|routine)\b/gi,
    /\b(technique|method|process|step|tool|material|finish|measurement)\b/gi
  ];
  
  results.forEach(r => {
    technicalPatterns.forEach(pattern => {
      const titleDescMatches = r.titleDescCombo.match(pattern) || [];
      const llmMatches = r.llmSummary?.match(pattern) || [];
      
      titleDescMatches.forEach(term => titleDescTerms.add(term.toLowerCase()));
      llmMatches.forEach(term => llmTerms.add(term.toLowerCase()));
    });
  });
  
  console.log(`Technical terms in Title+Description: ${titleDescTerms.size}`);
  console.log(`Technical terms in LLM Summaries: ${llmTerms.size}`);
  
  console.log('\n🎯 CLUSTERING IMPLICATIONS:\n');
  
  console.log('TITLE + DESCRIPTION:');
  console.log('- Preserves ALL original keywords and terms');
  console.log('- May include noise from promotional content');
  console.log('- Longer text = more context for embeddings');
  console.log('- Risk: Similar promo patterns across channels\n');
  
  console.log('LLM SUMMARIES:');
  console.log('- Focuses on core techniques and outcomes');
  console.log('- Removes ALL promotional noise');
  console.log('- Standardizes description style');
  console.log('- Risk: May lose some specific details\n');
  
  // Save detailed results
  await fs.writeFile(
    'clustering_quality_analysis.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log('✅ Detailed results saved to clustering_quality_analysis.json');
}

analyzeClusteringQuality().catch(console.error);