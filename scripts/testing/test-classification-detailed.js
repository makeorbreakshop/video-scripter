#!/usr/bin/env node

/**
 * Detailed test of video classification system
 */

import { createClient } from '@supabase/supabase-js';
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

async function testClassificationDetailed() {
  console.log('🧪 Detailed Classification System Test...\n');
  
  try {
    // 1. Check if clusters are loaded
    const { count: clusterCount } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id', { count: 'exact', head: true });
      
    console.log(`✅ Clusters loaded: ${clusterCount} clusters available`);
    
    // 2. Get a sample cluster
    const { data: sampleCluster } = await supabase
      .from('bertopic_clusters')
      .select('*')
      .limit(1)
      .single();
      
    if (sampleCluster) {
      console.log(`\n📊 Sample cluster:`);
      console.log(`   ID: ${sampleCluster.cluster_id}`);
      console.log(`   Topic: ${sampleCluster.topic_name}`);
      console.log(`   Videos: ${sampleCluster.video_count}`);
      console.log(`   Centroid length: ${sampleCluster.centroid_embedding?.length || 0}`);
    }
    
    // 3. Test import with verbose logging
    console.log(`\n🔄 Testing video import with classification...`);
    
    // Use a popular educational video for testing
    const testVideoId = 'jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video
    
    const response = await fetch('http://localhost:3000/api/video-import/unified', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'discovery',
        videoIds: [testVideoId],
        useQueue: false,
        options: {
          skipExports: true,
          skipEmbeddings: false,
          skipClassification: false,
          skipThumbnailEmbeddings: true, // Skip to save time
          forceReEmbed: true
        }
      })
    });
    
    const result = await response.json();
    console.log(`\n📦 Import result:`);
    console.log(`   Success: ${result.success}`);
    console.log(`   Videos processed: ${result.videosProcessed}`);
    console.log(`   Title embeddings: ${result.embeddingsGenerated?.titles || 0}`);
    console.log(`   Classifications: ${result.classificationsGenerated || 0}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.join(', ')}`);
    }
    
    // 4. Check if video was classified
    console.log(`\n🔍 Checking classification results...`);
    
    const { data: classifiedVideo } = await supabase
      .from('videos')
      .select('id, title, topic_level_1, topic_level_2, topic_level_3, format_primary, format_confidence, classified_at')
      .eq('id', testVideoId)
      .single();
      
    if (classifiedVideo) {
      console.log(`\n✅ Video classification:`);
      console.log(`   Title: ${classifiedVideo.title}`);
      console.log(`   Topic 1: ${classifiedVideo.topic_level_1 || 'Not classified'}`);
      console.log(`   Topic 2: ${classifiedVideo.topic_level_2 || 'Not classified'}`);
      console.log(`   Topic 3: ${classifiedVideo.topic_level_3 || 'Not classified'}`);
      console.log(`   Format: ${classifiedVideo.format_primary || 'Not classified'}`);
      console.log(`   Confidence: ${classifiedVideo.format_confidence || 'N/A'}`);
      console.log(`   Classified at: ${classifiedVideo.classified_at || 'Never'}`);
    }
    
    // 5. Check overall statistics
    const { count: totalClassified } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('format_primary', 'is', null);
      
    console.log(`\n📊 Overall statistics:`);
    console.log(`   Total videos with format classification: ${totalClassified}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testClassificationDetailed();