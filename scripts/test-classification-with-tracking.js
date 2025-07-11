#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables FIRST
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

import { createClient } from '@supabase/supabase-js';
import { videoClassificationService } from '../lib/video-classification-service.ts';
import { pineconeService } from '../lib/pinecone-service.ts';
import { Pinecone } from '@pinecone-database/pinecone';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testWithTracking() {
  console.log('🧪 Testing classification with format learning tracking...\n');
  
  try {
    // Get 20 unclassified videos to have a good mix
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('classified_at', null)
      .limit(20);
      
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
    
    const pc = new Pinecone({
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
    
    // Classify with lower threshold to trigger more LLM usage for testing
    console.log('\n🏷️  Classifying videos (lower threshold for more LLM usage)...');
    const classifications = await videoClassificationService.classifyBatch(
      videosWithEmbeddings,
      { 
        batchSize: 10, 
        logLowConfidence: true,
        useLLMThreshold: 0.7  // Higher threshold to trigger more LLM usage
      }
    );
    
    // Store classifications
    console.log('\n💾 Storing classifications...');
    await videoClassificationService.storeClassifications(classifications);
    
    // Show results
    console.log('\n📊 Classification Results:');
    let llmUsedCount = 0;
    classifications.forEach(c => {
      const video = videos.find(v => v.id === c.videoId);
      console.log(`\n🎥 ${video.title}`);
      console.log(`   Topic: ${c.topic.domain} > ${c.topic.niche} > ${c.topic.microTopic} (confidence: ${c.topic.confidence})`);
      console.log(`   Format: ${c.format.type} (confidence: ${c.format.confidence}, LLM: ${c.format.llmUsed})`);
      if (c.format.llmUsed) llmUsedCount++;
    });
    
    // Check tracking data
    console.log('\n\n📈 Checking tracking data...');
    const { data: trackingData, error: trackingError } = await supabase
      .from('format_detection_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
      
    if (trackingError) {
      console.error('❌ Error fetching tracking data:', trackingError);
    } else {
      console.log(`\n✅ Found ${trackingData.length} tracking records`);
      
      // Show some interesting cases where LLM disagreed with keywords
      const disagreements = trackingData.filter(t => 
        t.llm_was_used && t.keyword_format !== t.llm_format
      );
      
      if (disagreements.length > 0) {
        console.log(`\n🔍 Found ${disagreements.length} cases where LLM disagreed with keywords:`);
        disagreements.slice(0, 5).forEach(d => {
          console.log(`\n   Title: "${d.video_title}"`);
          console.log(`   Keyword: ${d.keyword_format} (${d.keyword_confidence})`);
          console.log(`   LLM: ${d.llm_format} (${d.llm_confidence})`);
          if (d.llm_reasoning) {
            console.log(`   Reasoning: ${d.llm_reasoning}`);
          }
        });
      }
    }
    
    const stats = videoClassificationService.getStatistics();
    console.log('\n\n📈 Session Statistics:');
    console.log(`   • Videos classified: ${classifications.length}`);
    console.log(`   • LLM calls: ${stats.llmCallCount} (${llmUsedCount} videos)`);
    console.log(`   • Low confidence: ${stats.lowConfidenceCount}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the test
testWithTracking();