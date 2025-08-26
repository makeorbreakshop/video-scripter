#!/usr/bin/env node

/**
 * Test combined embeddings on ALL videos with transcripts
 * This will give us a better comparison
 */

import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import * as fs from 'fs/promises';
import pLimit from 'p-limit';

dotenv.config();

// Initialize services
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Rate limiting for OpenAI
const limit = pLimit(3); // 3 concurrent requests

/**
 * Generate embedding for text using OpenAI
 */
async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
    dimensions: 512
  });
  
  return response.data[0].embedding;
}

/**
 * Extract key content from transcript
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

async function generateAllCombinedEmbeddings() {
  console.log('🧪 Generating Combined Embeddings for All Videos with Transcripts\n');

  try {
    // Get ALL videos with transcripts
    console.log('📊 Fetching all videos with transcripts...');
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
      .order('view_count', { ascending: false });

    if (error) throw error;

    console.log(`Found ${videos.length} videos with transcripts\n`);

    // We'll only generate embeddings for title_weighted strategy (best performer)
    const embeddings = [];
    let processed = 0;

    // Process in batches
    const processingPromises = videos.map(video => 
      limit(async () => {
        try {
          // Create weighted text: title repeated + transcript summary
          const transcriptSummary = extractTranscriptSummary(video.transcripts.transcript);
          const titleWeighted = `${video.title} ${video.title} ${video.title} ${transcriptSummary}`;
          
          // Generate embedding
          const embedding = await generateEmbedding(titleWeighted);
          
          processed++;
          if (processed % 10 === 0) {
            console.log(`Progress: ${processed}/${videos.length} videos processed`);
          }
          
          return {
            video_id: video.id,
            title: video.title,
            channel: video.channel_name,
            word_count: video.transcripts.word_count,
            embedding: embedding
          };
        } catch (error) {
          console.error(`Error processing ${video.title}:`, error.message);
          return null;
        }
      })
    );

    console.log('\n⏳ Generating embeddings (this may take a few minutes)...\n');
    const results = await Promise.all(processingPromises);
    
    // Filter out any failed embeddings
    const successfulEmbeddings = results.filter(r => r !== null);
    
    console.log(`\n✅ Successfully generated ${successfulEmbeddings.length} embeddings`);

    // Save embeddings
    const outputPath = 'outputs/all_combined_embeddings.json';
    await fs.mkdir('outputs', { recursive: true });
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        generated_date: new Date().toISOString(),
        total_videos: successfulEmbeddings.length,
        embedding_strategy: 'title_weighted',
        data: successfulEmbeddings
      }, null, 2)
    );

    console.log(`\n💾 Saved embeddings to ${outputPath}`);

    // Show statistics
    console.log('\n📈 Statistics:');
    console.log(`- Total videos with transcripts: ${videos.length}`);
    console.log(`- Successfully embedded: ${successfulEmbeddings.length}`);
    console.log(`- Failed: ${videos.length - successfulEmbeddings.length}`);
    
    // Group by channel
    const channelCounts = {};
    successfulEmbeddings.forEach(e => {
      channelCounts[e.channel] = (channelCounts[e.channel] || 0) + 1;
    });
    
    console.log('\n📺 Top channels:');
    Object.entries(channelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([channel, count]) => {
        console.log(`  - ${channel}: ${count} videos`);
      });

    console.log('\n🎯 Next step: Run BERTopic on these embeddings for better clustering!');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the generation
generateAllCombinedEmbeddings();