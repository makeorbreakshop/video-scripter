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
  console.log('🎯 Topic Classification from Local Embeddings');
  console.log('============================================\n');
  
  try {
    // Load embeddings from local file
    console.log('📂 Loading embeddings from exports/title-embeddings-aggregated.json...');
    const embeddingData = JSON.parse(fs.readFileSync('exports/title-embeddings-aggregated.json', 'utf8'));
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
    
    // Verify embeddings parsed correctly
    console.log(`✅ First cluster embedding dimension: ${clusters[0].centroid_embedding.length}`);
    
    // Get videos that need topics (paginated to avoid limits)
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
    
    // Debug: check first few videos
    if (videosToProcess.length > 0) {
      console.log('First video to process:', {
        id: videosToProcess[0].id,
        title: videosToProcess[0].metadata?.title || 'No title',
        hasEmbedding: !!(videosToProcess[0].values || videosToProcess[0].embedding),
        embeddingLength: (videosToProcess[0].values || videosToProcess[0].embedding)?.length
      });
    }
    
    if (videosToProcess.length === 0) {
      console.log('No videos to process!');
      console.log('\nNote: The embedding export is from', embeddingData.export_info?.timestamp || 'unknown date');
      console.log('Videos added after this date won\'t have embeddings in the export file.');
      return;
    }
    
    console.log(`\nNote: Only ${videosToProcess.length} videos have embeddings in the export.`);
    console.log('The rest were likely added after the export was created.');
    
    // Process in batches
    const BATCH_SIZE = 100;
    let processed = 0;
    let successCount = 0;
    let errorCount = 0;
    const startTime = Date.now();
    
    for (let i = 0; i < videosToProcess.length; i += BATCH_SIZE) {
      const batch = videosToProcess.slice(i, i + BATCH_SIZE);
      console.log(`\n🔄 Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(videosToProcess.length/BATCH_SIZE)}`);
      
      // Classify each video
      const updates = [];
      
      for (const video of batch) {
        try {
          // Get the embedding from the correct field
          const embedding = video.values || video.embedding;
          
          // Find k-nearest clusters (k=10)
          const distances = [];
          
          // Debug check
          if (!embedding || !Array.isArray(embedding)) {
            throw new Error(`Video ${video.id} has invalid embedding: ${typeof embedding}`);
          }
          
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
          
          const title = video.metadata?.title || video.title || 'Unknown';
          
          // Extract numeric IDs from the text labels
          const domainId = parseInt(domain.replace('domain_', ''), 10);
          const nicheId = parseInt(niche.replace('niche_', ''), 10);
          const topicId = parseInt(microTopic.replace('topic_', ''), 10);
          
          // Debug logging
          if (updates.length === 0) {
            console.log('Debug - First video processing:');
            console.log('  bestKey:', bestKey);
            console.log('  domain:', domain, '→', domainId);
            console.log('  niche:', niche, '→', nicheId);
            console.log('  topic:', microTopic, '→', topicId);
            console.log('  clusterId:', clusterId, '→', parseInt(clusterId, 10));
          }
          
          updates.push({
            id: video.id,
            title: title,
            topic_level_1: domainId,
            topic_level_2: nicheId,
            topic_level_3: topicId,
            topic_cluster_id: parseInt(clusterId, 10),
            topic_confidence: confidence
          });
          
          if (confidence > 0.8) {
            console.log(`   ✅ ${title.substring(0, 60)}...`);
            console.log(`      → ${domain} > ${niche} (${Math.round(confidence * 100)}%)`);
          }
          
        } catch (err) {
          console.error(`   ❌ Error processing video ${video.id}:`, err.message);
          errorCount++;
        }
      }
      
      // Update database
      for (const update of updates) {
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
      
      processed += batch.length;
      
      // Progress update
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (videosToProcess.length - processed) / rate;
      
      console.log(`\n📊 Progress: ${processed}/${videosToProcess.length} (${Math.round(processed/videosToProcess.length*100)}%)`);
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
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    console.error('Stack:', error.stack);
  }
}

classifyTopics().catch(console.error);