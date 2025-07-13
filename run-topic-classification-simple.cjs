const { createClient } = require('@supabase/supabase-js');
const { TopicDetectionService } = require('./lib/topic-detection-service.ts');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function classifyTopics() {
  console.log('🎯 Simple Topic Classification');
  console.log('==============================\n');
  
  // For now, let's just get a small batch of videos and assign random topics from clusters
  // This is a temporary workaround since we can't access Pinecone embeddings
  
  try {
    // Load topic service
    console.log('📊 Loading topic clusters...');
    const topicService = new TopicDetectionService(10);
    await topicService.loadClusters();
    const clusters = topicService.getAllClusters();
    console.log(`✅ Loaded ${clusters.length} topic clusters\n`);
    
    // Get videos needing topics
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name')
      .is('topic_level_1', null)
      .not('channel_id', 'is', null)
      .limit(100); // Start with 100 videos
      
    if (error) throw error;
    if (!videos || videos.length === 0) {
      console.log('No videos need topic classification');
      return;
    }
    
    console.log(`📹 Found ${videos.length} videos to classify\n`);
    
    // For each video, assign a topic based on title keywords
    // This is a simplified approach without embeddings
    const updates = [];
    
    for (const video of videos) {
      // Find best matching cluster based on title
      let bestCluster = null;
      let bestScore = 0;
      
      for (const cluster of clusters) {
        // Simple keyword matching
        const titleLower = video.title.toLowerCase();
        const topicLower = cluster.topic_name.toLowerCase();
        const parentLower = cluster.parent_topic.toLowerCase();
        
        let score = 0;
        if (titleLower.includes(topicLower)) score += 3;
        if (titleLower.includes(parentLower)) score += 2;
        
        // Check for common words
        const topicWords = topicLower.split(/\s+/);
        const titleWords = titleLower.split(/\s+/);
        for (const word of topicWords) {
          if (titleWords.includes(word) && word.length > 3) score += 1;
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestCluster = cluster;
        }
      }
      
      // If no good match, pick a reasonable default
      if (!bestCluster || bestScore < 2) {
        // Default to a general cluster
        bestCluster = clusters.find(c => c.grandparent_topic === 'Technology') || clusters[0];
      }
      
      updates.push({
        id: video.id,
        topic_level_1: bestCluster.grandparent_topic,
        topic_level_2: bestCluster.parent_topic,
        topic_level_3: bestCluster.topic_name,
        topic_cluster_id: bestCluster.cluster_id,
        topic_confidence: Math.min(bestScore / 10, 0.9) // Simple confidence based on score
      });
      
      console.log(`   ✅ ${video.title.substring(0, 50)}...`);
      console.log(`      → ${bestCluster.grandparent_topic} > ${bestCluster.parent_topic} (score: ${bestScore})`);
    }
    
    // Update database
    console.log('\n💾 Updating database...');
    let successCount = 0;
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
        
      if (!updateError) successCount++;
    }
    
    console.log(`\n✨ Classification Complete!`);
    console.log(`   ✅ Successfully classified: ${successCount} videos`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

classifyTopics().catch(console.error);