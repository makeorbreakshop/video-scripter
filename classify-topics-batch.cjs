const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
  console.log('🎯 Topic Classification from Local Embeddings (Optimized)');
  console.log('=======================================================\n');
  
  try {
    // Load embeddings from local file
    console.log('📂 Loading embeddings from exports/title-embeddings-complete-aggregated.json...');
    const embeddingData = JSON.parse(fs.readFileSync('exports/title-embeddings-complete-aggregated.json', 'utf8'));
    const videos = embeddingData.embeddings || embeddingData.videos || [];
    console.log(`✅ Loaded ${videos.length} video embeddings\n`);
    
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
    
    // Get videos that need topics
    console.log('🔍 Finding videos that need topics...');
    const videosNeedingTopics = [];
    let offset = 0;
    
    while (true) {
      const { data, error } = await supabase
        .from('videos')
        .select('id')
        .is('topic_level_1', null)
        .not('channel_id', 'is', null)
        .range(offset, offset + 999);
        
      if (error) throw error;
      if (!data || data.length === 0) break;
      
      videosNeedingTopics.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
    
    const needsTopicSet = new Set(videosNeedingTopics.map(v => v.id));
    console.log(`📹 Found ${needsTopicSet.size} videos needing topic classification`);
    
    // Filter embeddings to only those needing topics
    const videosToProcess = videos.filter(v => needsTopicSet.has(v.id));
    console.log(`🎯 Processing ${videosToProcess.length} videos with embeddings\n`);
    
    if (videosToProcess.length === 0) {
      console.log('No videos to process!');
      return;
    }
    
    // Process ALL videos first (compute classifications)
    console.log('🧮 Computing topic assignments for all videos...');
    const startCompute = Date.now();
    const allUpdates = [];
    
    for (const video of videosToProcess) {
      try {
        // Get the embedding from the correct field
        const embedding = video.values || video.embedding;
        
        if (!embedding || !Array.isArray(embedding)) {
          continue;
        }
        
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
          title: video.metadata?.title || video.title || 'Unknown',
          topic_level_1: domainId,
          topic_level_2: nicheId,
          topic_level_3: topicId,
          topic_cluster_id: parseInt(clusterId, 10),
          topic_confidence: confidence,
          domain: domain,
          niche: niche
        });
        
      } catch (err) {
        console.error(`❌ Error processing video ${video.id}:`, err.message);
      }
    }
    
    const computeTime = (Date.now() - startCompute) / 1000;
    console.log(`✅ Computed ${allUpdates.length} topic assignments in ${computeTime.toFixed(1)}s`);
    console.log(`   Rate: ${(allUpdates.length / computeTime).toFixed(1)} videos/sec\n`);
    
    // Now batch update the database
    console.log('💾 Updating database in batches...');
    const UPDATE_BATCH_SIZE = 500; // Supabase can handle larger batches
    let successCount = 0;
    let errorCount = 0;
    const startUpdate = Date.now();
    
    // Show some sample classifications
    console.log('\n📊 Sample classifications:');
    for (let i = 0; i < Math.min(5, allUpdates.length); i++) {
      const update = allUpdates[i];
      if (update.topic_confidence > 0.8) {
        console.log(`   ✅ ${update.title.substring(0, 60)}...`);
        console.log(`      → ${update.domain} > ${update.niche} (${Math.round(update.topic_confidence * 100)}%)`);
      }
    }
    console.log('');
    
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
      
      // Progress update
      const elapsed = (Date.now() - startUpdate) / 1000;
      const rate = successCount / elapsed;
      console.log(`   ✅ Batch complete. Total progress: ${successCount + errorCount}/${allUpdates.length}`);
      console.log(`   ⏱️  Update rate: ${rate.toFixed(1)} videos/sec\n`);
    }
    
    // Final summary
    const totalTime = (Date.now() - startCompute) / 1000;
    console.log('\n✨ Classification Complete!');
    console.log('=========================');
    console.log(`✅ Successfully classified: ${successCount} videos`);
    console.log(`❌ Errors: ${errorCount} videos`);
    console.log(`⏱️  Total time: ${(totalTime / 60).toFixed(1)} minutes`);
    console.log(`📊 Computation: ${computeTime.toFixed(1)}s, Database updates: ${((Date.now() - startUpdate) / 1000).toFixed(1)}s`);
    console.log(`📊 Overall rate: ${(successCount / totalTime).toFixed(1)} videos/sec`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    console.error('Stack:', error.stack);
  }
}

classifyTopics().catch(console.error);