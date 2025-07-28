#!/usr/bin/env node

/**
 * Test video classification system
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

async function testClassification() {
  console.log('🧪 Testing video classification system...\n');
  
  try {
    // 1. Check if clusters are loaded
    const { count: clusterCount } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id', { count: 'exact', head: true });
      
    console.log(`✅ Clusters loaded: ${clusterCount} clusters available`);
    
    // 2. Find a recent video with embeddings
    const { data: recentVideo } = await supabase
      .from('videos')
      .select('id, title, topic_level_1, topic_level_2, topic_level_3, format_primary')
      .order('import_date', { ascending: false })
      .limit(1)
      .single();
      
    if (!recentVideo) {
      console.log('❌ No videos found in database');
      return;
    }
    
    console.log(`\n📹 Most recent video: ${recentVideo.title}`);
    console.log(`   ID: ${recentVideo.id}`);
    console.log(`   Topic 1: ${recentVideo.topic_level_1 || 'Not classified'}`);
    console.log(`   Topic 2: ${recentVideo.topic_level_2 || 'Not classified'}`);
    console.log(`   Topic 3: ${recentVideo.topic_level_3 || 'Not classified'}`);
    console.log(`   Format: ${recentVideo.format_primary || 'Not classified'}`);
    
    // 3. Check if video has embeddings in Pinecone
    // Note: We can't directly query Pinecone from here, but we can check if classification should have worked
    
    if (!recentVideo.topic_level_1) {
      console.log(`\n⚠️  This video hasn't been classified yet`);
      
      // 4. Import a test video with classification
      console.log('\n🔄 Let\'s import a test video with classification enabled...');
      console.log('Run this command:');
      console.log(`
curl -X POST http://localhost:3000/api/video-import/unified \\
  -H "Content-Type: application/json" \\
  -d '{
    "source": "discovery",
    "videoIds": ["${recentVideo.id}"],
    "useQueue": false,
    "options": {
      "skipExports": true,
      "skipEmbeddings": false,
      "skipClassification": false,
      "forceReEmbed": true
    }
  }'
      `);
    }
    
    // 5. Check classification statistics
    const { count: topicCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('topic_level_1', 'is', null);
      
    const { count: formatCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('format_primary', 'is', null);
      
    console.log(`\n📊 Classification Statistics:`);
    console.log(`   Videos with topics: ${topicCount}`);
    console.log(`   Videos with formats: ${formatCount}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testClassification();