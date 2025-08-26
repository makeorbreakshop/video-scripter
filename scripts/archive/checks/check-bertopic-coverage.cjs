require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkBertopicCoverage() {
  console.log('Checking BERTopic classification coverage...');
  
  // Check overall classification coverage
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
    
  const { count: classifiedVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('topic_cluster_id', 'is', null);
    
  const { count: lowConfidenceVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .lt('topic_confidence', 0.3)
    .not('topic_cluster_id', 'is', null);
    
  const { count: outliers } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('topic_cluster_id', -1);
    
  console.log('\n=== Classification Coverage ==="');
  console.log(`Total videos: ${totalVideos}`);
  console.log(`Classified videos: ${classifiedVideos} (${(classifiedVideos/totalVideos*100).toFixed(2)}%)`);
  console.log(`Low confidence (<0.3): ${lowConfidenceVideos} (${(lowConfidenceVideos/classifiedVideos*100).toFixed(2)}%)`);
  console.log(`Outliers (topic_id=-1): ${outliers} (${(outliers/classifiedVideos*100).toFixed(2)}%)`);
  
  // Check topic hierarchy statistics
  const { data: topicStats } = await supabase
    .from('topic_categories')
    .select('level, topic_id, name, video_count')
    .order('level')
    .order('video_count', { ascending: false });
    
  const level1Topics = topicStats.filter(t => t.level === 1);
  const level2Topics = topicStats.filter(t => t.level === 2);
  const level3Topics = topicStats.filter(t => t.level === 3);
  
  console.log('\n=== Topic Hierarchy ==="');
  console.log(`Level 1 (Domains): ${level1Topics.length} topics`);
  console.log(`Level 2 (Niches): ${level2Topics.length} topics`);
  console.log(`Level 3 (Micro): ${level3Topics.length} topics`);
  
  console.log('\n=== Top 5 Topics per Level ==="');
  console.log('\nLevel 1 (Domains):');
  level1Topics.slice(0, 5).forEach(t => {
    console.log(`  - ${t.name}: ${t.video_count} videos`);
  });
  
  console.log('\nLevel 2 (Niches):');
  level2Topics.slice(0, 5).forEach(t => {
    console.log(`  - ${t.name}: ${t.video_count} videos`);
  });
  
  console.log('\nLevel 3 (Micro):');
  level3Topics.slice(0, 5).forEach(t => {
    console.log(`  - ${t.name}: ${t.video_count} videos`);
  });
  
  // Check what embeddings we're using
  const { count: withTitleEmbeddings } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('pinecone_embedded', true);
    
  const { count: withSummaryEmbeddings } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('llm_summary_embedded', true);
    
  console.log('\n=== Embedding Coverage ==="');
  console.log(`Videos with title embeddings: ${withTitleEmbeddings} (${(withTitleEmbeddings/totalVideos*100).toFixed(2)}%)`);
  console.log(`Videos with summary embeddings: ${withSummaryEmbeddings} (${(withSummaryEmbeddings/totalVideos*100).toFixed(2)}%)`);
  
  console.log('\nCurrent BERTopic clustering was done with TITLE-ONLY embeddings.');
  console.log('We can now re-run with TITLE+SUMMARY combined embeddings for better results.');
}

checkBertopicCoverage().catch(console.error);