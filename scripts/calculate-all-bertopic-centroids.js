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

async function calculateAllCentroids() {
  console.log('Starting centroid calculation for all BERTopic clusters...');
  
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
    
    console.log(`  Fetched ${allVideos.length} videos so far...`);
    
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
  
  // Initialize Pinecone indexes
  const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const summaryIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  
  // Process topics in parallel with concurrency limit
  const limit = pLimit(5); // Process 5 topics at a time
  const centroids = {};
  
  console.log('\nCalculating centroids for each topic...');
  
  const processTopic = async (topicId) => {
    const videoIds = videosByTopic[topicId];
    console.log(`Processing topic ${topicId} with ${videoIds.length} videos...`);
    
    // Fetch embeddings in batches
    const titleEmbeddings = [];
    const summaryEmbeddings = [];
    const fetchBatchSize = 100;
    
    for (let i = 0; i < videoIds.length; i += fetchBatchSize) {
      const batch = videoIds.slice(i, i + fetchBatchSize);
      
      // Fetch title embeddings
      try {
        const titleResults = await titleIndex.fetch(batch);
        Object.values(titleResults.records).forEach(record => {
          if (record.values) {
            titleEmbeddings.push(record.values);
          }
        });
      } catch (err) {
        console.error(`  Error fetching title embeddings for topic ${topicId}:`, err.message);
      }
      
      // Fetch summary embeddings
      try {
        const summaryResults = await summaryIndex.namespace('llm-summaries').fetch(batch);
        Object.values(summaryResults.records).forEach(record => {
          if (record.values) {
            summaryEmbeddings.push(record.values);
          }
        });
      } catch (err) {
        // Silently skip - summary embeddings might not exist for all videos
      }
    }
    
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
  
  // Process all topics
  const results = await Promise.all(
    topicIds.map(topicId => limit(() => processTopic(topicId)))
  );
  
  // Convert array to object
  results.forEach(result => {
    centroids[result.topic_id] = result;
  });
  
  // Save centroids to file
  const outputPath = './bertopic_centroids_complete_20250803.json';
  await fs.writeFile(outputPath, JSON.stringify({
    metadata: {
      total_topics: Object.keys(centroids).length,
      calculation_date: new Date().toISOString(),
      bertopic_model: 'bertopic_smart_hierarchy_20250801_131446',
      embedding_dimensions: {
        title: 512,
        summary: 512
      },
      blend_recipe: '30% title + 70% summary',
      total_videos_processed: allVideos.length
    },
    centroids: centroids
  }, null, 2));
  
  console.log(`\nCentroids saved to ${outputPath}`);
  console.log(`Calculated centroids for ${Object.keys(centroids).length} topics`);
  
  // Print summary statistics
  let totalTitleEmbeddings = 0;
  let totalSummaryEmbeddings = 0;
  let topicsWithBlended = 0;
  
  Object.values(centroids).forEach(c => {
    totalTitleEmbeddings += c.title_embedding_count;
    totalSummaryEmbeddings += c.summary_embedding_count;
    if (c.blended_centroid) topicsWithBlended++;
  });
  
  console.log('\nSummary:');
  console.log(`  Total videos processed: ${allVideos.length}`);
  console.log(`  Total title embeddings: ${totalTitleEmbeddings}`);
  console.log(`  Total summary embeddings: ${totalSummaryEmbeddings}`);
  console.log(`  Topics with blended centroids: ${topicsWithBlended}/${Object.keys(centroids).length}`);
  
  // Show top 10 topics by video count
  const topTopics = Object.values(centroids)
    .sort((a, b) => b.video_count - a.video_count)
    .slice(0, 10);
    
  console.log('\nTop 10 topics by video count:');
  topTopics.forEach(t => {
    console.log(`  ${t.topic_name}: ${t.video_count} videos (${t.title_coverage} title, ${t.summary_coverage} summary)`);
  });
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