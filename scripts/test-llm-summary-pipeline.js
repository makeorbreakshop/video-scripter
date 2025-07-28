#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
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

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// The action-first prompt
const ACTION_FIRST_PROMPT = `Analyze this YouTube description and extract only the core content, ignoring all promotional material.

Describe what happens or what is taught in 1-2 sentences. Start with an action verb or noun phrase. Never mention "video", "tutorial", or similar meta-references.

Focus purely on the content itself - the techniques, materials, concepts, and outcomes.`;

async function testPipeline() {
  console.log('🧪 Testing LLM Summary Pipeline\n');
  
  // Step 1: Get test videos
  console.log('📊 Step 1: Fetching test videos...');
  const { data: allVideos, error } = await supabase
    .from('videos')
    .select('id, title, channel_name, description')
    .not('description', 'is', null)
    .order('view_count', { ascending: false })
    .limit(500);
  
  // Filter for substantial descriptions in JavaScript
  const videos = allVideos?.filter(v => v.description && v.description.length >= 200).slice(0, 100) || [];
  
  if (error || !videos) {
    console.error('Failed to fetch videos:', error);
    return;
  }
  
  console.log(`✅ Found ${videos.length} test videos\n`);
  
  // Step 2: Test regular API (5 videos)
  console.log('🔬 Step 2: Testing regular API with 5 videos...');
  const regularApiResults = [];
  
  for (let i = 0; i < 5; i++) {
    const video = videos[i];
    const start = Date.now();
    
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
      
      const summary = response.choices[0].message.content.trim();
      const elapsed = Date.now() - start;
      
      regularApiResults.push({
        videoId: video.id,
        title: video.title,
        summary,
        elapsed,
        success: true
      });
      
      console.log(`  ✓ Video ${i+1}: ${elapsed}ms`);
      
    } catch (error) {
      console.error(`  ✗ Video ${i+1} failed:`, error.message);
      regularApiResults.push({
        videoId: video.id,
        success: false,
        error: error.message
      });
    }
  }
  
  // Display sample summaries
  console.log('\n📝 Sample Summaries:');
  regularApiResults.slice(0, 3).forEach((result, i) => {
    if (result.success) {
      console.log(`\n${i+1}. "${result.title}"`);
      console.log(`   Summary: ${result.summary}`);
    }
  });
  
  // Step 3: Test Batch API preparation
  console.log('\n\n🗂️ Step 3: Testing Batch API preparation...');
  
  const batchRequests = videos.slice(0, 20).map(video => ({
    custom_id: video.id,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
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
    }
  }));
  
  const jsonlContent = batchRequests.map(req => JSON.stringify(req)).join('\n');
  await fs.writeFile('test_batch.jsonl', jsonlContent);
  
  console.log('✅ Created test_batch.jsonl with 20 requests');
  console.log('   File size:', (jsonlContent.length / 1024).toFixed(2), 'KB');
  
  // Step 4: Test embeddings
  console.log('\n🔢 Step 4: Testing embedding generation...');
  
  const testSummary = regularApiResults.find(r => r.success)?.summary;
  if (testSummary) {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: testSummary,
    });
    
    const embedding = embeddingResponse.data[0].embedding;
    console.log(`✅ Generated embedding: ${embedding.length} dimensions`);
  }
  
  // Step 5: Test Pinecone namespace
  console.log('\n🌲 Step 5: Testing Pinecone integration...');
  
  try {
    const indexName = process.env.PINECONE_INDEX_NAME;
    const index = pinecone.index(indexName);
    
    // Check if we can access the index
    const stats = await index.describeIndexStats();
    console.log(`✅ Connected to Pinecone index: ${indexName}`);
    console.log(`   Total vectors: ${stats.totalRecordCount}`);
    console.log(`   Dimensions: ${stats.dimension}`);
    
    // Test namespace access
    const namespace = index.namespace('llm-summaries');
    console.log('✅ Namespace "llm-summaries" ready for use');
    
  } catch (error) {
    console.error('❌ Pinecone error:', error.message);
  }
  
  // Step 6: Cost estimation
  console.log('\n💰 Step 6: Cost Analysis...');
  
  const avgDescLength = videos.reduce((sum, v) => sum + (v.description?.length || 0), 0) / videos.length;
  const avgTokens = avgDescLength / 4; // Rough estimate
  const totalTokens = avgTokens * 178000;
  
  console.log(`\nBased on ${videos.length} sample videos:`);
  console.log(`  Average description length: ${avgDescLength.toFixed(0)} chars`);
  console.log(`  Estimated tokens per video: ${avgTokens.toFixed(0)}`);
  console.log(`  Total tokens for 178K videos: ${(totalTokens/1_000_000).toFixed(1)}M`);
  console.log(`\nCost estimates for 178K videos:`);
  console.log(`  Regular API: $${(totalTokens/1_000_000 * 0.15).toFixed(2)}`);
  console.log(`  Batch API (50% off): $${(totalTokens/1_000_000 * 0.15 * 0.5).toFixed(2)}`);
  
  // Step 7: Quality check
  console.log('\n✨ Step 7: Quality Checks...');
  
  const qualityChecks = regularApiResults.filter(r => r.success).map(r => ({
    hasVideoMention: r.summary.toLowerCase().includes('video'),
    hasTutorialMention: r.summary.toLowerCase().includes('tutorial'),
    startsWithVerb: /^[A-Z][a-z]+ing\s/.test(r.summary),
    length: r.summary.length
  }));
  
  console.log(`\nSummary quality (${qualityChecks.length} samples):`);
  console.log(`  Contains "video": ${qualityChecks.filter(c => c.hasVideoMention).length}`);
  console.log(`  Contains "tutorial": ${qualityChecks.filter(c => c.hasTutorialMention).length}`);
  console.log(`  Starts with verb: ${qualityChecks.filter(c => c.startsWithVerb).length}`);
  console.log(`  Average length: ${(qualityChecks.reduce((sum, c) => sum + c.length, 0) / qualityChecks.length).toFixed(0)} chars`);
  
  // Cleanup
  await fs.unlink('test_batch.jsonl').catch(() => {});
  
  console.log('\n✅ Pipeline test complete!');
  
  console.log('\n📋 NEXT STEPS:');
  console.log('1. Review the sample summaries above');
  console.log('2. If quality looks good, proceed with batch processing');
  console.log('3. Use: node scripts/generate-llm-summaries.js prepare');
}

testPipeline().catch(console.error);