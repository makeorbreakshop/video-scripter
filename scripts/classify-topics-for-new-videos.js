#!/usr/bin/env node

/**
 * Script to classify topics for videos that have embeddings but no topic assignments
 * Uses the TopicDetectionService with k-nearest neighbor approach
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { TopicDetectionService } from '../lib/topic-detection-service.ts';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 100; // Process in batches to avoid memory issues
const UPDATE_BATCH_SIZE = 50; // Update database in smaller batches

async function main() {
  console.log('🎯 Topic Classification for New Videos');
  console.log('=====================================\n');

  try {
    // Initialize the topic detection service
    console.log('📊 Loading topic detection service...');
    const topicService = new TopicDetectionService(10); // Use 10 nearest neighbors
    await topicService.loadClusters();
    console.log('✅ Topic detection service ready\n');

    // Get count of videos needing classification
    const { count: totalCount, error: countError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('topic_level_1', null)
      .not('channel_id', 'is', null)
      .eq('pinecone_embedding_version', 'v1'); // Only videos with embeddings in Pinecone

    if (countError) {
      console.error('Error counting videos:', countError);
      throw countError;
    }

    console.log(`📹 Found ${totalCount} videos needing topic classification`);
    console.log(`📦 Processing in batches of ${BATCH_SIZE}...\n`);

    let processed = 0;
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    // Process in batches
    while (processed < totalCount) {
      // Fetch batch of videos with embeddings
      const { data: videos, error: fetchError } = await supabase
        .from('videos')
        .select('id, title')
        .is('topic_level_1', null)
        .not('channel_id', 'is', null)
        .eq('pinecone_embedding_version', 3) // Only videos with embeddings in Pinecone
        .limit(BATCH_SIZE);

      if (fetchError) throw fetchError;
      if (!videos || videos.length === 0) break;

      console.log(`\n🔄 Processing batch: ${processed + 1} - ${processed + videos.length} of ${totalCount}`);

      // Process each video
      const updates = [];
      for (const video of videos) {
        try {
          // Parse embedding if it's a string (from pgvector)
          let embedding = video.title_embedding;
          if (typeof embedding === 'string') {
            embedding = embedding
              .slice(1, -1) // Remove [ and ]
              .split(',')
              .map(Number);
          }

          // Assign topic using k-nearest neighbor
          const assignment = await topicService.assignTopic(embedding);

          updates.push({
            id: video.id,
            topic_level_1: assignment.domain,
            topic_level_2: assignment.niche,
            topic_level_3: assignment.microTopic,
            topic_cluster_id: assignment.clusterId,
            topic_confidence: assignment.confidence
          });

          // Log high-confidence assignments
          if (assignment.confidence > 0.8) {
            console.log(`   ✅ ${video.title.substring(0, 60)}...`);
            console.log(`      → ${assignment.domain} > ${assignment.niche} (${Math.round(assignment.confidence * 100)}%)`);
          }

        } catch (error) {
          console.error(`   ❌ Error processing video ${video.id}:`, error.message);
          errorCount++;
        }
      }

      // Update database in smaller batches
      for (let i = 0; i < updates.length; i += UPDATE_BATCH_SIZE) {
        const batch = updates.slice(i, i + UPDATE_BATCH_SIZE);
        
        for (const update of batch) {
          const { error: updateError } = await supabase
            .from('videos')
            .update({
              topic_level_1: update.topic_level_1,
              topic_level_2: update.topic_level_2,
              topic_level_3: update.topic_level_3,
              topic_cluster_id: update.topic_cluster_id,
              topic_confidence: update.topic_confidence
            })
            .eq('id', update.id);

          if (updateError) {
            console.error(`   ❌ Failed to update video ${update.id}:`, updateError.message);
            errorCount++;
          } else {
            successCount++;
          }
        }
      }

      processed += videos.length;
      
      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (totalCount - processed) / rate;
      
      console.log(`\n📊 Progress: ${processed}/${totalCount} (${Math.round(processed/totalCount*100)}%)`);
      console.log(`   ⏱️  Rate: ${rate.toFixed(1)} videos/sec`);
      console.log(`   ⏳ ETA: ${Math.round(remaining / 60)} minutes`);
      console.log(`   ✅ Success: ${successCount}, ❌ Errors: ${errorCount}`);
    }

    // Final summary
    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n✨ Classification Complete!');
    console.log('=========================');
    console.log(`✅ Successfully classified: ${successCount} videos`);
    console.log(`❌ Errors: ${errorCount} videos`);
    console.log(`⏱️  Total time: ${Math.round(totalTime / 60)} minutes`);
    console.log(`📊 Average rate: ${(successCount / totalTime).toFixed(1)} videos/sec`);

    // Verify coverage
    const { count: remainingCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('topic_level_1', null)
      .not('channel_id', 'is', null);

    console.log(`\n📹 Remaining unclassified videos: ${remainingCount}`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);