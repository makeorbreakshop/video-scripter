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

async function migrateAndClassify() {
  console.log('🔄 Video Classification Migration & Update\n');
  
  try {
    // Step 1: Check current state
    const { data: stats } = await supabase.rpc('get_classification_stats');
    console.log('📊 Current State:');
    console.log(`   • Videos with OLD BERTopic topics: ${stats[0].has_old_bert_topics}`);
    console.log(`   • Videos with NEW classification: ${stats[0].has_new_classification}`);
    console.log(`   • Videos with NO topics: ${stats[0].no_topics_at_all}`);
    console.log(`   • Total videos: ${stats[0].total_videos}\n`);
    
    // Step 2: Migrate existing BERTopic assignments
    console.log('🔄 Step 1: Migrating existing BERTopic assignments...');
    await migrateBertTopics();
    
    // Step 3: Load classification service
    console.log('\n🔄 Step 2: Loading classification service...');
    await videoClassificationService.topicService.loadClusters();
    await pineconeService.connect();
    console.log('✅ Services loaded');
    
    // Step 4: Run format detection on ALL videos
    console.log('\n🔄 Step 3: Running format detection on all videos...');
    await runFormatDetection();
    
    // Step 5: Run topic detection only on videos without topics
    console.log('\n🔄 Step 4: Running topic detection on videos without topics...');
    await runTopicDetection();
    
    console.log('\n🎉 MIGRATION COMPLETE!');
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

async function migrateBertTopics() {
  // First, let's map the existing topic assignments to the new format
  const { data: bertopicMappings } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id, topic_name, parent_topic, grandparent_topic');
    
  const clusterMap = new Map();
  bertopicMappings.forEach(m => {
    clusterMap.set(m.cluster_id, {
      domain: m.grandparent_topic,
      niche: m.parent_topic,
      micro: m.topic_name
    });
  });
  
  // Update videos with existing BERTopic assignments
  let updated = 0;
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, topic_level_1, topic_level_2, topic_level_3')
      .not('topic_level_3', 'is', null)
      .is('topic_domain', null)
      .range(offset, offset + batchSize - 1);
      
    if (error) throw error;
    if (!videos || videos.length === 0) break;
    
    // Update each video
    for (const video of videos) {
      // The topic_level_3 should correspond to a cluster_id
      const clusterInfo = clusterMap.get(video.topic_level_3);
      
      if (clusterInfo) {
        await supabase
          .from('videos')
          .update({
            topic_domain: clusterInfo.domain,
            topic_niche: clusterInfo.niche,
            topic_micro: clusterInfo.micro,
            topic_cluster_id: video.topic_level_3,
            topic_confidence: 1.0, // High confidence for direct BERTopic assignments
            classified_at: new Date().toISOString()
          })
          .eq('id', video.id);
        
        updated++;
      }
    }
    
    console.log(`   • Migrated ${updated} videos so far...`);
    offset += batchSize;
  }
  
  console.log(`✅ Migrated ${updated} BERTopic assignments to new format`);
}

async function runFormatDetection() {
  let processed = 0;
  let offset = 0;
  const batchSize = 100;
  
  // Get total count
  const { count } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .is('format_type', null);
    
  console.log(`   • Need to detect formats for ${count} videos`);
  
  while (offset < count) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('format_type', null)
      .range(offset, offset + batchSize - 1);
      
    if (error) throw error;
    if (!videos || videos.length === 0) break;
    
    // Detect formats for this batch
    const formats = await Promise.all(
      videos.map(async (video) => {
        const result = await videoClassificationService.formatService.detectFormat(
          video.title,
          video.description
        );
        
        return {
          id: video.id,
          format_type: result.format,
          format_confidence: result.confidence,
          format_llm_used: result.llmUsed || false
        };
      })
    );
    
    // Update videos with format info
    for (const format of formats) {
      await supabase
        .from('videos')
        .update(format)
        .eq('id', format.id);
    }
    
    processed += videos.length;
    const progress = (processed / count * 100).toFixed(1);
    console.log(`   • Progress: ${progress}% (${processed}/${count})`);
    
    offset += batchSize;
    
    // Small delay to avoid overloading
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`✅ Format detection complete for ${processed} videos`);
}

async function runTopicDetection() {
  let processed = 0;
  let skipped = 0;
  let offset = 0;
  const batchSize = 100;
  
  // Get videos that need topic assignment
  const { count } = await supabase
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .is('topic_domain', null);
    
  console.log(`   • Need to assign topics for ${count} videos`);
  
  while (offset < count) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('topic_domain', null)
      .range(offset, offset + batchSize - 1);
      
    if (error) throw error;
    if (!videos || videos.length === 0) break;
    
    // Get embeddings from Pinecone
    const videoIds = videos.map(v => v.id);
    const response = await pineconeService.index.fetch(videoIds);
    
    // Prepare videos with embeddings
    const videosWithEmbeddings = videos
      .map(video => {
        const record = response.records[video.id];
        if (!record || !record.values) {
          skipped++;
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
    
    if (videosWithEmbeddings.length > 0) {
      // Classify topics
      const classifications = await videoClassificationService.classifyBatch(
        videosWithEmbeddings,
        { batchSize: 50, logLowConfidence: true }
      );
      
      // Store only topic information (format already done)
      for (const c of classifications) {
        await supabase
          .from('videos')
          .update({
            topic_domain: c.topic.domain,
            topic_niche: c.topic.niche,
            topic_micro: c.topic.microTopic,
            topic_cluster_id: c.topic.clusterId,
            topic_confidence: c.topic.confidence,
            classified_at: new Date().toISOString()
          })
          .eq('id', c.videoId);
      }
      
      processed += classifications.length;
    }
    
    const progress = ((offset + videos.length) / count * 100).toFixed(1);
    console.log(`   • Progress: ${progress}% (${processed} classified, ${skipped} no embeddings)`);
    
    offset += batchSize;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`✅ Topic detection complete: ${processed} classified, ${skipped} skipped (no embeddings)`);
}

// Add the RPC function if it doesn't exist
async function createStatsFunction() {
  const { error } = await supabase.rpc('get_classification_stats', {}, { count: 'exact', head: true });
  
  if (error && error.code === '42883') {
    // Function doesn't exist, create it
    await supabase.rpc('query', {
      query: `
        CREATE OR REPLACE FUNCTION get_classification_stats()
        RETURNS TABLE (
          has_old_bert_topics bigint,
          has_new_classification bigint,
          only_old_topics bigint,
          no_topics_at_all bigint,
          total_videos bigint
        ) AS $$
        BEGIN
          RETURN QUERY
          SELECT 
            COUNT(*) FILTER (WHERE topic_level_1 IS NOT NULL) as has_old_bert_topics,
            COUNT(*) FILTER (WHERE topic_domain IS NOT NULL) as has_new_classification,
            COUNT(*) FILTER (WHERE topic_level_1 IS NOT NULL AND topic_domain IS NULL) as only_old_topics,
            COUNT(*) FILTER (WHERE topic_level_1 IS NULL AND topic_domain IS NULL) as no_topics_at_all,
            COUNT(*) as total_videos
          FROM videos;
        END;
        $$ LANGUAGE plpgsql;
      `
    });
  }
}

// Run the migration
createStatsFunction().then(() => {
  migrateAndClassify();
});