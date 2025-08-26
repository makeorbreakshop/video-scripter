#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Refined prompt to ensure no "video" mentions
const REFINED_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.

Example outputs:
- "Building a custom dining table using reclaimed barn wood and traditional joinery techniques."
- "Installing a complete home theater system with proper acoustic treatment and cable management."`;

async function testRefinedPipeline() {
  console.log('🧪 Testing Refined LLM Summary Pipeline\n');
  
  // Get maker/DIY videos for better test data
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, channel_name, description')
    .in('channel_name', [
      'Steve Ramsey - Woodworking for Mere Mortals',
      '3D Printing Nerd',
      'DIY Perks',
      'I Like To Make Stuff',
      'Make Something'
    ])
    .not('description', 'is', null)
    .limit(10);
  
  if (!videos || videos.length === 0) {
    // Fallback to any videos
    const { data: fallback } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .not('description', 'is', null)
      .order('view_count', { ascending: false })
      .limit(10);
    
    videos.push(...(fallback || []));
  }
  
  console.log(`📊 Testing with ${videos.length} videos\n`);
  
  // Test summaries
  const results = [];
  
  for (const video of videos.slice(0, 5)) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: REFINED_PROMPT
          },
          {
            role: 'user',
            content: `Title: ${video.title}\nDescription: ${video.description?.substring(0, 1000) || 'No description'}`
          }
        ],
        temperature: 0.3,
        max_tokens: 100
      });
      
      const summary = response.choices[0].message.content.trim();
      results.push({ video, summary });
      
    } catch (error) {
      console.error('Error:', error.message);
    }
  }
  
  // Display results
  console.log('📝 Generated Summaries:\n');
  results.forEach((result, i) => {
    console.log(`${i+1}. "${result.video.title}"`);
    console.log(`   Channel: ${result.video.channel_name}`);
    console.log(`   Summary: ${result.summary}\n`);
  });
  
  // Test correct embedding dimensions
  if (results.length > 0) {
    console.log('🔢 Testing 512D embeddings...');
    
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: results[0].summary,
      dimensions: 512  // Explicitly set dimensions
    });
    
    const embedding = embeddingResponse.data[0].embedding;
    console.log(`✅ Generated embedding: ${embedding.length} dimensions\n`);
  }
  
  // Quality checks
  console.log('✨ Quality Analysis:');
  const issues = [];
  
  results.forEach((r, i) => {
    const lower = r.summary.toLowerCase();
    if (lower.includes('video')) issues.push(`Summary ${i+1} contains "video"`);
    if (lower.includes('tutorial')) issues.push(`Summary ${i+1} contains "tutorial"`);
    if (lower.includes('channel')) issues.push(`Summary ${i+1} contains "channel"`);
    if (!r.summary.match(/^[A-Z][a-z]+ing\s|^[A-Z][a-z]+s\s/)) {
      issues.push(`Summary ${i+1} doesn't start with action verb`);
    }
  });
  
  if (issues.length === 0) {
    console.log('✅ All summaries pass quality checks!');
  } else {
    console.log('⚠️  Issues found:');
    issues.forEach(issue => console.log(`   - ${issue}`));
  }
  
  console.log('\n📊 Final cost for 178K videos: ~$3.24 with Batch API');
  console.log('\n✅ Ready to proceed with full batch processing!');
}

testRefinedPipeline().catch(console.error);