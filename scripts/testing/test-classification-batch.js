#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables FIRST before any imports that use them
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

// Now import modules that depend on environment variables
import { createClient } from '@supabase/supabase-js';
import { videoClassificationService } from '../lib/video-classification-service.ts';
import { pineconeService } from '../lib/pinecone-service.ts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testBatchClassification() {
  console.log('🧪 Testing batch classification on 10 videos...\n');
  
  try {
    // Get 10 unclassified videos
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('classified_at', null)
      .limit(10);
      
    if (error) throw error;
    
    console.log(`📊 Found ${videos.length} unclassified videos to test`);
    
    // Load clusters
    console.log('\n🔄 Loading BERTopic clusters...');
    await videoClassificationService.topicService.loadClusters();
    
    // Initialize Pinecone
    console.log('🔌 Initializing Pinecone...');
    await pineconeService.initializeIndex();
    
    // Get embeddings
    const videoIds = videos.map(v => v.id);
    console.log('\n📥 Fetching embeddings from Pinecone...');
    
    // Use the Pinecone client directly
    const pc = new (await import('@pinecone-database/pinecone')).Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    const index = pc.index(process.env.PINECONE_INDEX_NAME);
    const response = await index.fetch(videoIds);
    
    // Prepare videos with embeddings
    const videosWithEmbeddings = videos
      .map(video => {
        const record = response.records[video.id];
        if (!record || !record.values) {
          console.log(`⚠️  No embedding found for: ${video.title}`);
          return null;
        }
        
        return {
          id: video.id,
          title: video.title,
          titleEmbedding: record.values,
          channel: video.channel_name,
          description: video.description
        };
      })
      .filter(v => v !== null);
    
    console.log(`\n✅ Found embeddings for ${videosWithEmbeddings.length} videos`);
    
    if (videosWithEmbeddings.length === 0) {
      console.log('❌ No videos with embeddings to classify');
      return;
    }
    
    // Classify
    console.log('\n🏷️  Classifying videos...');
    const classifications = await videoClassificationService.classifyBatch(
      videosWithEmbeddings,
      { batchSize: 10, logLowConfidence: true }
    );
    
    // Store classifications
    console.log('\n💾 Storing classifications...');
    await videoClassificationService.storeClassifications(classifications);
    
    // Show results
    console.log('\n📊 Classification Results:');
    classifications.forEach(c => {
      const video = videos.find(v => v.id === c.videoId);
      console.log(`\n🎥 ${video.title}`);
      console.log(`   Topic: ${c.topic.domain} > ${c.topic.niche} > ${c.topic.microTopic} (confidence: ${c.topic.confidence})`);
      console.log(`   Format: ${c.format.type} (confidence: ${c.format.confidence}, LLM: ${c.format.llmUsed})`);
    });
    
    const stats = videoClassificationService.getStatistics();
    console.log('\n📈 Statistics:');
    console.log(`   • LLM calls: ${stats.llmCallCount}`);
    console.log(`   • Low confidence: ${stats.lowConfidenceCount}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the test
testBatchClassification();