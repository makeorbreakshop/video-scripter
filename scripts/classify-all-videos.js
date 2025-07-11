#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { videoClassificationService } from '../lib/video-classification-service.ts';
import { pineconeService } from '../lib/pinecone-service.ts';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function classifyAllVideos() {
  console.log('🏷️  Starting bulk video classification...\n');
  
  try {
    // Step 1: Count videos that need classification
    const { data: stats } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .is('classified_at', null);
      
    console.log(`📊 Found ${stats.count} videos that need classification`);
    
    // Step 2: Load BERTopic clusters
    console.log('\n🔄 Loading BERTopic clusters...');
    await videoClassificationService.topicService.loadClusters();
    console.log('✅ Clusters loaded successfully');
    
    // Step 3: Process videos in batches
    const batchSize = 100;
    let offset = 0;
    let totalClassified = 0;
    let videosWithoutEmbeddings = 0;
    
    console.log(`\n🚀 Processing videos in batches of ${batchSize}...`);
    
    while (offset < stats.count) {
      // Get batch of unclassified videos
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, description')
        .is('classified_at', null)
        .range(offset, offset + batchSize - 1);
        
      if (error) {
        console.error('Error fetching videos:', error);
        break;
      }
      
      if (!videos || videos.length === 0) break;
      
      console.log(`\n📦 Processing batch ${Math.floor(offset / batchSize) + 1} (${videos.length} videos)...`);
      
      // Get embeddings for these videos from Pinecone
      const videoIds = videos.map(v => v.id);
      const embeddings = await getEmbeddingsFromPinecone(videoIds);
      
      // Prepare videos with embeddings for classification
      const videosWithEmbeddings = videos
        .map(video => {
          const embedding = embeddings.get(video.id);
          if (!embedding) {
            videosWithoutEmbeddings++;
            return null;
          }
          
          return {
            id: video.id,
            title: video.title,
            titleEmbedding: embedding,
            channel: video.channel_name,
            description: video.description
          };
        })
        .filter(v => v !== null);
      
      if (videosWithEmbeddings.length === 0) {
        console.log('⚠️  No videos with embeddings in this batch');
        offset += batchSize;
        continue;
      }
      
      // Classify the batch
      try {
        const classifications = await videoClassificationService.classifyBatch(
          videosWithEmbeddings,
          { batchSize: 50, logLowConfidence: true }
        );
        
        // Store classifications
        await videoClassificationService.storeClassifications(classifications);
        
        totalClassified += classifications.length;
        console.log(`✅ Classified ${classifications.length} videos in this batch`);
        
        // Show progress
        const progress = ((offset + videos.length) / stats.count * 100).toFixed(1);
        console.log(`📊 Progress: ${progress}% (${totalClassified} classified, ${videosWithoutEmbeddings} skipped)`);
        
      } catch (error) {
        console.error('❌ Error classifying batch:', error);
      }
      
      offset += batchSize;
      
      // Add a small delay to avoid overloading the API
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final statistics
    const finalStats = videoClassificationService.getStatistics();
    console.log('\n🎉 CLASSIFICATION COMPLETE!');
    console.log(`📊 Final Statistics:`);
    console.log(`   • Total videos classified: ${totalClassified}`);
    console.log(`   • Videos without embeddings: ${videosWithoutEmbeddings}`);
    console.log(`   • LLM calls made: ${finalStats.llmCallCount}`);
    console.log(`   • Low confidence cases: ${finalStats.lowConfidenceCount}`);
    console.log(`   • Average confidence - Topic: ${finalStats.averageConfidence.topic.toFixed(2)}, Format: ${finalStats.averageConfidence.format.toFixed(2)}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

async function getEmbeddingsFromPinecone(videoIds) {
  const embeddings = new Map();
  
  try {
    // Connect to Pinecone
    await pineconeService.connect();
    
    // Fetch vectors in batches (Pinecone limit)
    const fetchBatchSize = 100;
    for (let i = 0; i < videoIds.length; i += fetchBatchSize) {
      const batch = videoIds.slice(i, i + fetchBatchSize);
      
      try {
        const response = await pineconeService.index.fetch(batch);
        
        // Extract embeddings from response
        Object.entries(response.records).forEach(([id, record]) => {
          if (record.values) {
            embeddings.set(id, record.values);
          }
        });
      } catch (error) {
        console.error(`Error fetching embeddings for batch:`, error);
      }
    }
    
  } catch (error) {
    console.error('Error connecting to Pinecone:', error);
  }
  
  return embeddings;
}

// Run the classification
classifyAllVideos();