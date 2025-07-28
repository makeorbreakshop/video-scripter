#!/usr/bin/env node

/**
 * Test generating combined title + transcript embeddings
 * Compare with title-only embeddings for BERTopic improvement
 */

import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import * as fs from 'fs/promises';

dotenv.config();

// Initialize services
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generate embedding for text using OpenAI
 */
async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 512 // Match our existing embeddings
  });
  
  return response.data[0].embedding;
}

/**
 * Extract key content from transcript (first/last portions + middle sample)
 */
function extractTranscriptSummary(transcript, maxWords = 500) {
  const words = transcript.split(/\s+/);
  
  if (words.length <= maxWords) {
    return transcript;
  }
  
  // Take first 200 words, middle 100 words, last 200 words
  const first = words.slice(0, 200).join(' ');
  const middleStart = Math.floor(words.length / 2) - 50;
  const middle = words.slice(middleStart, middleStart + 100).join(' ');
  const last = words.slice(-200).join(' ');
  
  return `${first} ... ${middle} ... ${last}`;
}

async function testCombinedEmbeddings() {
  console.log('🧪 Testing Combined Title + Transcript Embeddings\n');

  try {
    // Get videos that have both titles and transcripts
    console.log('📊 Fetching videos with transcripts...');
    const { data: videos, error } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_name,
        view_count,
        transcripts!inner(
          transcript,
          word_count
        )
      `)
      .order('view_count', { ascending: false })
      .limit(20);

    if (error) throw error;

    console.log(`Found ${videos.length} videos with transcripts\n`);

    // Prepare data for different embedding strategies
    const embeddingTests = [];

    for (const video of videos) {
      console.log(`\n📹 Processing: ${video.title.substring(0, 50)}...`);
      console.log(`   Channel: ${video.channel_name}`);
      console.log(`   Transcript words: ${video.transcripts.word_count}`);

      // Strategy 1: Title only (baseline)
      const titleOnly = video.title;
      
      // Strategy 2: Title repeated (weighted) + transcript summary
      const transcriptSummary = extractTranscriptSummary(video.transcripts.transcript);
      const titleWeighted = `${video.title} ${video.title} ${video.title} ${transcriptSummary}`;
      
      // Strategy 3: Title + key phrases from transcript
      // Extract first 100 words as context
      const transcriptContext = video.transcripts.transcript.split(/\s+/).slice(0, 100).join(' ');
      const titleWithContext = `${video.title} Content: ${transcriptContext}`;

      console.log('   🔄 Generating embeddings...');
      
      // Generate embeddings for each strategy
      const [titleEmb, weightedEmb, contextEmb] = await Promise.all([
        generateEmbedding(titleOnly),
        generateEmbedding(titleWeighted),
        generateEmbedding(titleWithContext)
      ]);

      embeddingTests.push({
        video_id: video.id,
        title: video.title,
        channel: video.channel_name,
        word_count: video.transcripts.word_count,
        embeddings: {
          title_only: titleEmb,
          title_weighted: weightedEmb,
          title_with_context: contextEmb
        }
      });

      console.log('   ✅ Embeddings generated');
    }

    // Save embeddings for analysis
    const outputPath = 'outputs/combined_embeddings_test.json';
    await fs.mkdir('outputs', { recursive: true });
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        test_date: new Date().toISOString(),
        videos_tested: embeddingTests.length,
        strategies: ['title_only', 'title_weighted', 'title_with_context'],
        data: embeddingTests
      }, null, 2)
    );

    console.log(`\n💾 Saved test embeddings to ${outputPath}`);

    // Calculate similarity between strategies
    console.log('\n📊 Analyzing embedding differences:\n');
    
    for (const test of embeddingTests.slice(0, 5)) { // Show first 5
      console.log(`Video: ${test.title.substring(0, 50)}...`);
      
      // Calculate cosine similarity between strategies
      const sim_weighted = cosineSimilarity(test.embeddings.title_only, test.embeddings.title_weighted);
      const sim_context = cosineSimilarity(test.embeddings.title_only, test.embeddings.title_with_context);
      const sim_weighted_context = cosineSimilarity(test.embeddings.title_weighted, test.embeddings.title_with_context);
      
      console.log(`  Title vs Weighted: ${(sim_weighted * 100).toFixed(1)}% similar`);
      console.log(`  Title vs Context: ${(sim_context * 100).toFixed(1)}% similar`);
      console.log(`  Weighted vs Context: ${(sim_weighted_context * 100).toFixed(1)}% similar`);
      console.log('');
    }

    // Summary statistics
    console.log('📈 Summary:');
    console.log(`- Tested ${embeddingTests.length} videos`);
    console.log(`- 3 embedding strategies compared`);
    console.log(`- Average transcript length: ${Math.round(embeddingTests.reduce((sum, t) => sum + t.word_count, 0) / embeddingTests.length)} words`);
    console.log('\nNext steps:');
    console.log('1. Run BERTopic clustering on each embedding strategy');
    console.log('2. Compare cluster quality and topic coherence');
    console.log('3. Choose best strategy for full dataset');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Run the test
testCombinedEmbeddings();