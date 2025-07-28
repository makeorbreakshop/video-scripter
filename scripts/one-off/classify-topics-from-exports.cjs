const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const { TopicDetectionService } = require('./lib/topic-detection-service.ts');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function classifyTopics() {
  console.log('🎯 Topic Classification from Local Embeddings');
  console.log('============================================\n');
  
  try {
    // Load embeddings from local file
    console.log('📂 Loading embeddings from exports/all-title-embeddings-from-db.json...');
    const embeddingData = JSON.parse(fs.readFileSync('exports/all-title-embeddings-from-db.json', 'utf8'));
    console.log(`✅ Loaded ${embeddingData.videos.length} video embeddings\n`);
    
    // Load topic service
    console.log('📊 Loading topic detection service...');
    const topicService = new TopicDetectionService(10);
    await topicService.loadClusters();
    console.log('✅ Topic detection service ready\n');
    
    // Get videos that need topics
    const { data: videosNeedingTopics, error } = await supabase
      .from('videos')
      .select('id')
      .is('topic_level_1', null)
      .not('channel_id', 'is', null);
      
    if (error) throw error;
    
    const needsTopicSet = new Set(videosNeedingTopics.map(v => v.id));
    console.log(`📹 Found ${needsTopicSet.size} videos needing topic classification\n`);
    
    // Filter embeddings to only those needing topics
    const videosToProcess = embeddingData.videos.filter(v => needsTopicSet.has(v.id));
    console.log(`🎯 Processing ${videosToProcess.length} videos with embeddings\n`);
    
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
          const assignment = await topicService.assignTopic(video.embedding);
          
          updates.push({
            id: video.id,
            topic_level_1: assignment.domain,
            topic_level_2: assignment.niche,
            topic_level_3: assignment.microTopic,
            topic_cluster_id: assignment.clusterId,
            topic_confidence: assignment.confidence
          });
          
          if (assignment.confidence > 0.8) {
            console.log(`   ✅ ${video.title.substring(0, 60)}...`);
            console.log(`      → ${assignment.domain} > ${assignment.niche} (${Math.round(assignment.confidence * 100)}%)`);
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
  }
}

classifyTopics().catch(console.error);