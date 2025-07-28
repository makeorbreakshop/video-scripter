const { createClient } = require('@supabase/supabase-js');
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

// Calculate cosine similarity
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have the same dimension');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function classifyTopics() {
  console.log('🎯 Topic Classification from Pinecone Embeddings');
  console.log('===============================================\n');
  
  try {
    // Connect to Pinecone index
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME || 'youtube-titles-prod');
    console.log('✅ Connected to Pinecone index\n');
    
    // Load BERTopic clusters
    console.log('📊 Loading BERTopic clusters from database...');
    const clusters = [];
    let clusterOffset = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('bertopic_clusters')
        .select('*')
        .range(clusterOffset, clusterOffset + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      
      clusters.push(...data);
      
      if (data.length < batchSize) break;
      clusterOffset += batchSize;
    }
    
    console.log(`✅ Loaded ${clusters.length} BERTopic clusters\n`);
    
    // Parse centroid embeddings
    clusters.forEach(cluster => {
      if (typeof cluster.centroid_embedding === 'string') {
        cluster.centroid_embedding = cluster.centroid_embedding
          .slice(1, -1) // Remove [ and ]
          .split(',')
          .map(Number);
      }
    });
    
    // Get videos that need topics and have embeddings
    console.log('🔍 Finding videos that need topics...');
    const videosNeedingTopics = [];
    let offset = 0;
    
    while (true) {
      const { data, error } = await supabase
        .from('videos')
        .select('id, title')
        .is('topic_level_1', null)
        .not('channel_id', 'is', null)
        .not('pinecone_embedding_version', 'is', null)
        .range(offset, offset + 999);
        
      if (error) throw error;
      if (!data || data.length === 0) break;
      
      videosNeedingTopics.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
    
    console.log(`📹 Found ${videosNeedingTopics.length} videos needing topic classification\n`);
    
    if (videosNeedingTopics.length === 0) {
      console.log('No videos need topic classification!');
      return;
    }
    
    // Process in batches
    const FETCH_BATCH_SIZE = 100; // Pinecone fetch limit
    const UPDATE_BATCH_SIZE = 500;
    const allUpdates = [];
    let fetchedCount = 0;
    const startTime = Date.now();
    
    console.log('🔄 Fetching embeddings from Pinecone...');
    
    for (let i = 0; i < videosNeedingTopics.length; i += FETCH_BATCH_SIZE) {
      const batch = videosNeedingTopics.slice(i, i + FETCH_BATCH_SIZE);
      const videoIds = batch.map(v => v.id);
      
      try {
        // Fetch embeddings from Pinecone
        const fetchResponse = await index.fetch(videoIds);
        
        for (const video of batch) {
          const vectorData = fetchResponse.records[video.id];
          if (!vectorData || !vectorData.values) {
            console.log(`⚠️  No embedding found for video ${video.id}`);
            continue;
          }
          
          const embedding = vectorData.values;
          
          // Find k-nearest clusters (k=10)
          const distances = [];
          
          for (const cluster of clusters) {
            const similarity = cosineSimilarity(embedding, cluster.centroid_embedding);
            const distance = 1 - similarity;
            distances.push({ cluster, distance });
          }
          
          // Sort by distance and take top 10
          distances.sort((a, b) => a.distance - b.distance);
          const neighbors = distances.slice(0, 10);
          
          // Vote for best topic
          const votes = {};
          neighbors.forEach(({ cluster, distance }) => {
            const weight = 1 / (1 + distance);
            const key = `${cluster.grandparent_topic}|${cluster.parent_topic}|${cluster.topic_name}|${cluster.cluster_id}`;
            votes[key] = (votes[key] || 0) + weight;
          });
          
          // Find winning topic
          let bestKey = null;
          let bestVote = 0;
          for (const [key, vote] of Object.entries(votes)) {
            if (vote > bestVote) {
              bestVote = vote;
              bestKey = key;
            }
          }
          
          const [domain, niche, microTopic, clusterId] = bestKey.split('|');
          const confidence = Math.min(bestVote / 5, 0.95); // Normalize confidence
          
          // Extract numeric IDs from the text labels
          const domainId = parseInt(domain.replace('domain_', ''), 10);
          const nicheId = parseInt(niche.replace('niche_', ''), 10);
          const topicId = parseInt(microTopic.replace('topic_', ''), 10);
          
          allUpdates.push({
            id: video.id,
            title: video.title,
            topic_level_1: domainId,
            topic_level_2: nicheId,
            topic_level_3: topicId,
            topic_cluster_id: parseInt(clusterId, 10),
            topic_confidence: confidence,
            domain: domain,
            niche: niche
          });
        }
        
        fetchedCount += batch.length;
        
        // Progress update
        const progress = Math.round(fetchedCount / videosNeedingTopics.length * 100);
        console.log(`   📊 Fetched ${fetchedCount}/${videosNeedingTopics.length} embeddings (${progress}%)`);
        
      } catch (error) {
        console.error(`❌ Error fetching batch ${Math.floor(i/FETCH_BATCH_SIZE) + 1}:`, error.message);
      }
    }
    
    console.log(`\n✅ Fetched embeddings for ${allUpdates.length} videos`);
    console.log(`⚠️  ${videosNeedingTopics.length - allUpdates.length} videos had no embeddings in Pinecone\n`);
    
    // Show sample classifications
    console.log('📊 Sample classifications:');
    for (let i = 0; i < Math.min(5, allUpdates.length); i++) {
      const update = allUpdates[i];
      if (update.topic_confidence > 0.8) {
        console.log(`   ✅ ${update.title.substring(0, 60)}...`);
        console.log(`      → ${update.domain} > ${update.niche} (${Math.round(update.topic_confidence * 100)}%)`);
      }
    }
    console.log('');
    
    // Update database in batches
    console.log('💾 Updating database...');
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < allUpdates.length; i += UPDATE_BATCH_SIZE) {
      const batch = allUpdates.slice(i, i + UPDATE_BATCH_SIZE);
      console.log(`🔄 Updating batch ${Math.floor(i/UPDATE_BATCH_SIZE) + 1}/${Math.ceil(allUpdates.length/UPDATE_BATCH_SIZE)} (${batch.length} videos)`);
      
      // Update each video in the batch
      const updatePromises = batch.map(update => 
        supabase
          .from('videos')
          .update({
            topic_level_1: update.topic_level_1,
            topic_level_2: update.topic_level_2,
            topic_level_3: update.topic_level_3,
            topic_cluster_id: update.topic_cluster_id,
            topic_confidence: update.topic_confidence
          })
          .eq('id', update.id)
      );
      
      // Execute all updates in parallel
      const results = await Promise.allSettled(updatePromises);
      
      // Count successes and failures
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && !result.value.error) {
          successCount++;
        } else {
          errorCount++;
          if (result.status === 'rejected') {
            console.error(`   ❌ Failed to update ${batch[index].id}:`, result.reason);
          } else if (result.value.error) {
            console.error(`   ❌ Failed to update ${batch[index].id}:`, result.value.error.message);
          }
        }
      });
    }
    
    // Final summary
    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n✨ Classification Complete!');
    console.log('=========================');
    console.log(`✅ Successfully classified: ${successCount} videos`);
    console.log(`❌ Errors: ${errorCount} videos`);
    console.log(`⏱️  Total time: ${(totalTime / 60).toFixed(1)} minutes`);
    console.log(`📊 Average rate: ${(successCount / totalTime).toFixed(1)} videos/sec`);
    
    // Check remaining videos
    const { count: remainingCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('topic_level_1', null)
      .not('channel_id', 'is', null);
      
    console.log(`\n📹 Remaining unclassified videos: ${remainingCount}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    console.error('Stack:', error.stack);
  }
}

classifyTopics().catch(console.error);