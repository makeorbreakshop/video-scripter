import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { BERTopicClassificationService } from '../lib/bertopic-classification-service.ts';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function testCentroidClassification() {
  console.log('Testing centroid-based BERTopic classification...\n');
  
  // Initialize the service
  const classifier = new BERTopicClassificationService();
  await classifier.initialize();
  
  // Initialize Pinecone indexes
  const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const summaryIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  
  // Get some test videos
  console.log('Fetching test videos...');
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, topic_cluster_id, topic_domain, topic_niche, topic_micro, bertopic_version')
    .eq('bertopic_version', 'v1_2025-08-01')
    .gte('topic_cluster_id', 0)
    .lte('topic_cluster_id', 215)
    .limit(5);
    
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  console.log(`Found ${videos.length} test videos\n`);
  
  // Test classification for each video
  for (const video of videos) {
    console.log(`\nVideo: ${video.title.substring(0, 60)}...`);
    console.log(`Current classification: Topic ${video.topic_cluster_id}`);
    console.log(`  ${video.topic_domain || 'Unknown'} > ${video.topic_niche || 'Unknown'} > ${video.topic_micro || 'Unknown'}`);
    
    // Fetch embeddings from Pinecone
    let titleEmbedding = null;
    let summaryEmbedding = null;
    
    try {
      const titleResult = await titleIndex.fetch([video.id]);
      if (titleResult.records[video.id]) {
        titleEmbedding = titleResult.records[video.id].values;
      }
    } catch (err) {
      console.log('  No title embedding found');
    }
    
    try {
      const summaryResult = await summaryIndex.namespace('llm-summaries').fetch([video.id]);
      if (summaryResult.records[video.id]) {
        summaryEmbedding = summaryResult.records[video.id].values;
      }
    } catch (err) {
      console.log('  No summary embedding found');
    }
    
    if (!titleEmbedding && !summaryEmbedding) {
      console.log('  ⚠️ No embeddings found, skipping');
      continue;
    }
    
    // Test different classification methods
    console.log('\nClassification results:');
    
    // 1. Title only
    if (titleEmbedding) {
      const titleResult = await classifier.classifyVideos([{
        id: video.id,
        embedding: titleEmbedding
      }]);
      
      if (titleResult.length > 0) {
        const assignment = titleResult[0].assignment;
        const match = assignment.clusterId === video.topic_cluster_id ? '✅' : '❌';
        console.log(`  Title only: Topic ${assignment.clusterId} (confidence: ${assignment.confidence.toFixed(3)}) ${match}`);
      }
    }
    
    // 2. Summary only
    if (summaryEmbedding) {
      const summaryResult = await classifier.classifyVideos([{
        id: video.id,
        embedding: summaryEmbedding
      }]);
      
      if (summaryResult.length > 0) {
        const assignment = summaryResult[0].assignment;
        const match = assignment.clusterId === video.topic_cluster_id ? '✅' : '❌';
        console.log(`  Summary only: Topic ${assignment.clusterId} (confidence: ${assignment.confidence.toFixed(3)}) ${match}`);
      }
    }
    
    // 3. Blended (if both available)
    if (titleEmbedding && summaryEmbedding) {
      const blendedResult = await classifier.classifyVideos([{
        id: video.id,
        titleEmbedding: titleEmbedding,
        summaryEmbedding: summaryEmbedding,
        blendWeights: { title: 0.3, summary: 0.7 }
      }]);
      
      if (blendedResult.length > 0) {
        const assignment = blendedResult[0].assignment;
        const match = assignment.clusterId === video.topic_cluster_id ? '✅' : '❌';
        console.log(`  Blended (30/70): Topic ${assignment.clusterId} (confidence: ${assignment.confidence.toFixed(3)}) ${match}`);
      }
    }
    
    console.log('---');
  }
  
  // Test outlier detection
  console.log('\n\nTesting outlier detection with random embedding...');
  const randomEmbedding = Array(512).fill(0).map(() => Math.random() - 0.5);
  
  const outlierResult = await classifier.classifyVideos([{
    id: 'test-outlier',
    embedding: randomEmbedding
  }]);
  
  if (outlierResult.length > 0) {
    const assignment = outlierResult[0].assignment;
    console.log(`Random embedding: Topic ${assignment.clusterId} (confidence: ${assignment.confidence.toFixed(3)})`);
    console.log(`  Should be outlier (-1): ${assignment.clusterId === -1 ? '✅' : '❌'}`);
  }
  
  // Get stats
  const stats = classifier.getAllTopics();
  console.log(`\n📊 Classifier stats:`);
  console.log(`  - Total centroids loaded: ${stats.centroids.size}`);
  console.log(`  - Total topics in metadata: ${Object.keys(stats.topics).length}`);
  
  console.log('\n✅ Test complete!');
}

// Run the test
testCentroidClassification().catch(console.error);