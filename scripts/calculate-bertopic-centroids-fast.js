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
  console.log('Starting centroid calculation for BERTopic clusters...');
  
  // Load the BERTopic hierarchy data
  const bertopicData = JSON.parse(
    await fs.readFile('./bertopic_smart_hierarchy_20250801_131446.json', 'utf-8')
  );
  
  // Only process topics from the August 1st model (0-215)
  const validTopicIds = Array.from({length: 216}, (_, i) => i);
  
  console.log('Processing topics 0-215 from August 1st BERTopic model...');
  
  // Get all videos with valid BERTopic classifications
  console.log('Fetching videos with BERTopic classifications...');
  
  // Fetch in batches to avoid limit
  let allVideos = [];
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, topic_cluster_id')
      .in('topic_cluster_id', validTopicIds)
      .order('topic_cluster_id')
      .range(offset, offset + batchSize - 1);
      
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    if (!videos || videos.length === 0) break;
    
    allVideos = allVideos.concat(videos);
    offset += batchSize;
    
    if (videos.length < batchSize) break;
  }
  
  const videos = allVideos;
  
  console.log(`Found ${videos.length} videos with valid topic assignments`);
  
  // Group videos by topic
  const videosByTopic = {};
  videos.forEach(video => {
    if (!videosByTopic[video.topic_cluster_id]) {
      videosByTopic[video.topic_cluster_id] = [];
    }
    videosByTopic[video.topic_cluster_id].push(video);
  });
  
  console.log(`Videos are grouped into ${Object.keys(videosByTopic).length} topics`);
  
  // Initialize Pinecone indexes
  const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const summaryIndex = pinecone.index(process.env.PINECONE_INDEX_NAME); // Summary embeddings are in same index, different namespace
  
  // Calculate centroids for each topic
  const centroids = {};
  
  // Process only first 10 topics for testing
  const topicsToProcess = Object.keys(videosByTopic).slice(0, 10).map(id => parseInt(id));
  console.log(`Processing first 10 topics for testing: ${topicsToProcess.join(', ')}`);
  
  for (const topicId of topicsToProcess) {
    const topicVideos = videosByTopic[topicId];
    console.log(`\nProcessing topic ${topicId} with ${topicVideos.length} videos...`);
    
    // Fetch embeddings in batches
    const titleEmbeddings = [];
    const summaryEmbeddings = [];
    const batchSize = 100;
    
    for (let i = 0; i < topicVideos.length; i += batchSize) {
      const batch = topicVideos.slice(i, i + batchSize);
      const videoIds = batch.map(v => v.id);
      
      // Fetch title embeddings
      try {
        const titleResults = await titleIndex.fetch(videoIds);
        Object.values(titleResults.records).forEach(record => {
          if (record.values) {
            titleEmbeddings.push(record.values);
          }
        });
      } catch (err) {
        console.error(`Error fetching title embeddings for batch:`, err.message);
      }
      
      // Fetch summary embeddings
      try {
        const summaryResults = await summaryIndex.namespace('llm-summaries').fetch(videoIds);
        Object.values(summaryResults.records).forEach(record => {
          if (record.values) {
            summaryEmbeddings.push(record.values);
          }
        });
      } catch (err) {
        console.error(`Error fetching summary embeddings for batch:`, err.message);
      }
      
      // Progress update
      if ((i + batchSize) % 500 === 0 || i + batchSize >= topicVideos.length) {
        console.log(`  Processed ${Math.min(i + batchSize, topicVideos.length)}/${topicVideos.length} videos`);
      }
    }
    
    console.log(`  Found ${titleEmbeddings.length} title embeddings and ${summaryEmbeddings.length} summary embeddings`);
    
    // Calculate average embeddings (centroids)
    const titleCentroid = calculateAverageEmbedding(titleEmbeddings);
    const summaryCentroid = calculateAverageEmbedding(summaryEmbeddings);
    
    // Get topic name from hierarchy
    const topicName = bertopicData.topic_labels?.[topicId] || `Topic ${topicId}`;
    
    centroids[topicId] = {
      topic_id: topicId,
      topic_name: topicName,
      video_count: topicVideos.length,
      title_centroid: titleCentroid,
      summary_centroid: summaryCentroid,
      title_embedding_count: titleEmbeddings.length,
      summary_embedding_count: summaryEmbeddings.length
    };
  }
  
  // Save centroids to file
  const outputPath = './bertopic_centroids_test_20250803.json';
  await fs.writeFile(outputPath, JSON.stringify({
    metadata: {
      total_topics: Object.keys(centroids).length,
      calculation_date: new Date().toISOString(),
      bertopic_model: 'bertopic_smart_hierarchy_20250801_131446',
      embedding_dimensions: {
        title: 512,
        summary: 512
      },
      note: 'Test run with first 10 topics only'
    },
    centroids: centroids
  }, null, 2));
  
  console.log(`\nCentroids saved to ${outputPath}`);
  console.log(`Calculated centroids for ${Object.keys(centroids).length} topics`);
  
  // Print summary statistics
  const stats = Object.values(centroids).map(c => ({
    topic: c.topic_name,
    videos: c.video_count,
    title_coverage: ((c.title_embedding_count / c.video_count) * 100).toFixed(1) + '%',
    summary_coverage: ((c.summary_embedding_count / c.video_count) * 100).toFixed(1) + '%'
  }));
  
  console.log('\nProcessed topics:');
  stats.forEach(s => {
    console.log(`  ${s.topic}: ${s.videos} videos (${s.title_coverage} title, ${s.summary_coverage} summary)`);
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