import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import pLimit from 'p-limit';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

// Configuration
const PARALLEL_TOPICS = 2; // Reduce parallelism to avoid rate limits
const FETCH_BATCH_SIZE = 50; // Smaller batches for Pinecone
const CHECKPOINT_FILE = './bertopic_centroids_checkpoint.json';
const OUTPUT_FILE = './bertopic_centroids_complete_20250803.json';

async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return { completed: [], centroids: {} };
  }
}

async function saveCheckpoint(checkpoint) {
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

async function calculateAllCentroids() {
  console.log('Starting centroid calculation for all BERTopic clusters...');
  
  // Load checkpoint to resume if interrupted
  const checkpoint = await loadCheckpoint();
  console.log(`Loaded checkpoint with ${checkpoint.completed.length} completed topics`);
  
  // Load the BERTopic hierarchy data
  const bertopicData = JSON.parse(
    await fs.readFile('./bertopic_smart_hierarchy_20250801_131446.json', 'utf-8')
  );
  
  // Get all videos with valid topic assignments (0-215)
  console.log('Fetching all videos with valid BERTopic classifications...');
  
  const allVideos = [];
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, topic_cluster_id')
      .gte('topic_cluster_id', 0)
      .lte('topic_cluster_id', 215)
      .order('topic_cluster_id')
      .range(offset, offset + batchSize - 1);
      
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    if (!videos || videos.length === 0) break;
    
    allVideos.push(...videos);
    offset += batchSize;
    
    if (offset % 10000 === 0) {
      console.log(`  Fetched ${allVideos.length} videos so far...`);
    }
    
    if (videos.length < batchSize) break;
  }
  
  console.log(`Found ${allVideos.length} videos with valid topic assignments`);
  
  // Group videos by topic
  const videosByTopic = {};
  allVideos.forEach(video => {
    if (!videosByTopic[video.topic_cluster_id]) {
      videosByTopic[video.topic_cluster_id] = [];
    }
    videosByTopic[video.topic_cluster_id].push(video.id);
  });
  
  const topicIds = Object.keys(videosByTopic).map(id => parseInt(id)).sort((a, b) => a - b);
  console.log(`Videos are grouped into ${topicIds.length} topics`);
  
  // Filter out already completed topics
  const remainingTopics = topicIds.filter(id => !checkpoint.completed.includes(id));
  console.log(`${remainingTopics.length} topics remaining to process`);
  
  // Initialize Pinecone indexes
  const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const summaryIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  
  // Process topics with limited parallelism
  const limit = pLimit(PARALLEL_TOPICS);
  
  console.log('\nCalculating centroids for each topic...');
  
  const processTopic = async (topicId) => {
    const videoIds = videosByTopic[topicId];
    console.log(`\n[Topic ${topicId}] Starting with ${videoIds.length} videos...`);
    
    const startTime = Date.now();
    
    // Fetch embeddings in smaller batches
    const titleEmbeddings = [];
    const summaryEmbeddings = [];
    
    for (let i = 0; i < videoIds.length; i += FETCH_BATCH_SIZE) {
      const batch = videoIds.slice(i, i + FETCH_BATCH_SIZE);
      
      // Progress indicator
      if (i > 0 && i % 500 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  [Topic ${topicId}] Progress: ${i}/${videoIds.length} videos (${elapsed}s)`);
      }
      
      // Fetch title embeddings with retry
      let retries = 3;
      while (retries > 0) {
        try {
          const titleResults = await titleIndex.fetch(batch);
          Object.values(titleResults.records).forEach(record => {
            if (record.values) {
              titleEmbeddings.push(record.values);
            }
          });
          break;
        } catch (err) {
          retries--;
          if (retries === 0) {
            console.error(`  [Topic ${topicId}] Failed to fetch title embeddings after 3 retries:`, err.message);
          } else {
            console.log(`  [Topic ${topicId}] Retrying title fetch... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      // Fetch summary embeddings with retry
      retries = 3;
      while (retries > 0) {
        try {
          const summaryResults = await summaryIndex.namespace('llm-summaries').fetch(batch);
          Object.values(summaryResults.records).forEach(record => {
            if (record.values) {
              summaryEmbeddings.push(record.values);
            }
          });
          break;
        } catch (err) {
          retries--;
          if (retries === 0) {
            // Silently skip - summary embeddings might not exist
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`  [Topic ${topicId}] Fetched ${titleEmbeddings.length} title and ${summaryEmbeddings.length} summary embeddings`);
    
    // Calculate centroids
    const titleCentroid = calculateAverageEmbedding(titleEmbeddings);
    const summaryCentroid = calculateAverageEmbedding(summaryEmbeddings);
    
    // Blend centroid (30% title + 70% summary) if both exist
    let blendedCentroid = null;
    if (titleCentroid && summaryCentroid && titleEmbeddings.length > 0 && summaryEmbeddings.length > 0) {
      blendedCentroid = titleCentroid.map((val, idx) => 
        0.3 * val + 0.7 * summaryCentroid[idx]
      );
    }
    
    // Get topic name and hierarchy
    const topicName = bertopicData.topic_labels?.[topicId] || `Topic ${topicId}`;
    const level2 = bertopicData.metadata?.mappings?.topic_to_l2?.[topicId];
    const level1 = level2 !== undefined ? bertopicData.metadata?.mappings?.l2_to_l1?.[level2] : undefined;
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  [Topic ${topicId}] Completed in ${elapsed}s`);
    
    return {
      topic_id: topicId,
      topic_name: topicName,
      topic_level_1: level1,
      topic_level_2: level2,
      topic_level_3: topicId,
      video_count: videoIds.length,
      title_centroid: titleCentroid,
      summary_centroid: summaryCentroid,
      blended_centroid: blendedCentroid,
      title_embedding_count: titleEmbeddings.length,
      summary_embedding_count: summaryEmbeddings.length,
      title_coverage: ((titleEmbeddings.length / videoIds.length) * 100).toFixed(1) + '%',
      summary_coverage: ((summaryEmbeddings.length / videoIds.length) * 100).toFixed(1) + '%'
    };
  };
  
  // Process remaining topics
  for (const topicId of remainingTopics) {
    try {
      const result = await processTopic(topicId);
      
      // Update checkpoint
      checkpoint.centroids[topicId] = result;
      checkpoint.completed.push(topicId);
      await saveCheckpoint(checkpoint);
      
      console.log(`  [Topic ${topicId}] Saved to checkpoint (${checkpoint.completed.length}/${topicIds.length} complete)\n`);
    } catch (err) {
      console.error(`  [Topic ${topicId}] Fatal error:`, err);
      console.log('  Checkpoint saved. You can restart the script to continue from here.\n');
    }
  }
  
  // Save final results
  const finalData = {
    metadata: {
      total_topics: Object.keys(checkpoint.centroids).length,
      calculation_date: new Date().toISOString(),
      bertopic_model: 'bertopic_smart_hierarchy_20250801_131446',
      embedding_dimensions: {
        title: 512,
        summary: 512
      },
      blend_recipe: '30% title + 70% summary',
      total_videos_processed: allVideos.length
    },
    centroids: checkpoint.centroids
  };
  
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(finalData, null, 2));
  
  console.log(`\nCentroids saved to ${OUTPUT_FILE}`);
  console.log(`Calculated centroids for ${Object.keys(checkpoint.centroids).length} topics`);
  
  // Print summary statistics
  let totalTitleEmbeddings = 0;
  let totalSummaryEmbeddings = 0;
  let topicsWithBlended = 0;
  
  Object.values(checkpoint.centroids).forEach(c => {
    totalTitleEmbeddings += c.title_embedding_count;
    totalSummaryEmbeddings += c.summary_embedding_count;
    if (c.blended_centroid) topicsWithBlended++;
  });
  
  console.log('\nSummary:');
  console.log(`  Total videos processed: ${allVideos.length}`);
  console.log(`  Total title embeddings: ${totalTitleEmbeddings}`);
  console.log(`  Total summary embeddings: ${totalSummaryEmbeddings}`);
  console.log(`  Topics with blended centroids: ${topicsWithBlended}/${Object.keys(checkpoint.centroids).length}`);
  
  // Clean up checkpoint file
  await fs.unlink(CHECKPOINT_FILE).catch(() => {});
  console.log('\nCheckpoint file cleaned up. Process complete!');
}

function calculateAverageEmbedding(embeddings) {
  if (embeddings.length === 0) return null;
  
  const dimensions = embeddings[0].length;
  const average = new Array(dimensions).fill(0);
  
  // Sum all embeddings
  embeddings.forEach(embedding => {
    for (let i = 0; i < dimensions; i++) {
      average[i] += embedding[i];
    }
  });
  
  // Divide by count to get average
  for (let i = 0; i < dimensions; i++) {
    average[i] /= embeddings.length;
  }
  
  return average;
}

// Run the script
calculateAllCentroids().catch(console.error);