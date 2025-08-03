import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function calculateCentroids() {
  console.log('Starting centroid calculation for BERTopic clusters (sample version)...');
  
  // Load the BERTopic hierarchy data
  const bertopicData = JSON.parse(
    await fs.readFile('./bertopic_smart_hierarchy_20250801_131446.json', 'utf-8')
  );
  
  // Get topic statistics first
  console.log('Getting topic statistics...');
  const { data: topicStats, error: statsError } = await supabase
    .from('videos')
    .select('topic_cluster_id')
    .gte('topic_cluster_id', 0)
    .lte('topic_cluster_id', 215);
    
  if (statsError) {
    console.error('Error fetching stats:', statsError);
    return;
  }
  
  // Count videos per topic
  const topicCounts = {};
  topicStats.forEach(v => {
    topicCounts[v.topic_cluster_id] = (topicCounts[v.topic_cluster_id] || 0) + 1;
  });
  
  console.log(`Found ${Object.keys(topicCounts).length} topics with videos`);
  console.log('Top 10 largest topics:');
  Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([topic, count]) => {
      console.log(`  Topic ${topic}: ${count} videos`);
    });
  
  // Initialize Pinecone indexes
  const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const summaryIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  
  // Calculate centroids for a few topics as proof of concept
  const centroids = {};
  const testTopics = [0, 1, 10, 50, 100, 150, 200]; // Sample across the range
  const maxVideosPerTopic = 100; // Limit videos to keep it fast
  
  console.log(`\nProcessing ${testTopics.length} sample topics with max ${maxVideosPerTopic} videos each...`);
  
  for (const topicId of testTopics) {
    if (!topicCounts[topicId]) {
      console.log(`\nSkipping topic ${topicId} (no videos)`);
      continue;
    }
    
    console.log(`\nProcessing topic ${topicId} (${topicCounts[topicId]} total videos)...`);
    
    // Get sample of videos for this topic
    const { data: topicVideos, error } = await supabase
      .from('videos')
      .select('id')
      .eq('topic_cluster_id', topicId)
      .limit(maxVideosPerTopic);
      
    if (error) {
      console.error(`Error fetching videos for topic ${topicId}:`, error);
      continue;
    }
    
    const videoIds = topicVideos.map(v => v.id);
    console.log(`  Fetching embeddings for ${videoIds.length} videos...`);
    
    // Fetch embeddings
    const titleEmbeddings = [];
    const summaryEmbeddings = [];
    
    try {
      const titleResults = await titleIndex.fetch(videoIds);
      Object.values(titleResults.records).forEach(record => {
        if (record.values) {
          titleEmbeddings.push(record.values);
        }
      });
    } catch (err) {
      console.error(`  Error fetching title embeddings:`, err.message);
    }
    
    try {
      const summaryResults = await summaryIndex.namespace('llm-summaries').fetch(videoIds);
      Object.values(summaryResults.records).forEach(record => {
        if (record.values) {
          summaryEmbeddings.push(record.values);
        }
      });
    } catch (err) {
      console.error(`  Error fetching summary embeddings:`, err.message);
    }
    
    console.log(`  Found ${titleEmbeddings.length} title and ${summaryEmbeddings.length} summary embeddings`);
    
    // Calculate centroids
    const titleCentroid = calculateAverageEmbedding(titleEmbeddings);
    const summaryCentroid = calculateAverageEmbedding(summaryEmbeddings);
    
    // Blend centroid (30% title + 70% summary) if both exist
    let blendedCentroid = null;
    if (titleCentroid && summaryCentroid) {
      blendedCentroid = titleCentroid.map((val, idx) => 
        0.3 * val + 0.7 * summaryCentroid[idx]
      );
    }
    
    // Get topic name
    const topicName = bertopicData.topic_labels?.[topicId] || `Topic ${topicId}`;
    
    centroids[topicId] = {
      topic_id: topicId,
      topic_name: topicName,
      total_videos_in_topic: topicCounts[topicId],
      sample_size: videoIds.length,
      title_centroid: titleCentroid,
      summary_centroid: summaryCentroid,
      blended_centroid: blendedCentroid,
      title_embedding_count: titleEmbeddings.length,
      summary_embedding_count: summaryEmbeddings.length
    };
  }
  
  // Save results
  const outputPath = './bertopic_centroids_sample_20250803.json';
  await fs.writeFile(outputPath, JSON.stringify({
    metadata: {
      topics_processed: Object.keys(centroids).length,
      calculation_date: new Date().toISOString(),
      bertopic_model: 'bertopic_smart_hierarchy_20250801_131446',
      max_videos_per_topic: maxVideosPerTopic,
      blend_recipe: '30% title + 70% summary',
      note: 'Sample calculation for proof of concept'
    },
    centroids: centroids
  }, null, 2));
  
  console.log(`\nCentroids saved to ${outputPath}`);
  
  // Print summary
  console.log('\nSummary:');
  Object.values(centroids).forEach(c => {
    console.log(`  ${c.topic_name}: ${c.sample_size}/${c.total_videos_in_topic} videos`);
    console.log(`    - Title coverage: ${((c.title_embedding_count / c.sample_size) * 100).toFixed(1)}%`);
    console.log(`    - Summary coverage: ${((c.summary_embedding_count / c.sample_size) * 100).toFixed(1)}%`);
    console.log(`    - Has blended centroid: ${c.blended_centroid ? 'Yes' : 'No'}`);
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
calculateCentroids().catch(console.error);