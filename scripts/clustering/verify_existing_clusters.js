import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyExistingClusters() {
  console.log('Checking existing cluster assignments...\n');
  
  // Count videos with topic assignments
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
  
  const { count: videosWithTopics } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('topic_level_3', 'is', null);
  
  console.log(`Total videos: ${totalVideos}`);
  console.log(`Videos with topic assignments: ${videosWithTopics}`);
  console.log(`Coverage: ${(videosWithTopics/totalVideos*100).toFixed(1)}%`);
  
  // Get unique topic counts
  const { data: uniqueTopics } = await supabase
    .from('videos')
    .select('topic_level_3')
    .not('topic_level_3', 'is', null);
  
  const uniqueL3 = new Set(uniqueTopics.map(v => v.topic_level_3));
  console.log(`\nUnique Level 3 topics: ${uniqueL3.size}`);
  
  // Sample some topics
  const { data: samples } = await supabase
    .from('videos')
    .select('id, title, topic_level_3')
    .not('topic_level_3', 'is', null)
    .limit(10);
  
  console.log('\nSample assignments:');
  samples.forEach(v => {
    console.log(`  Topic ${v.topic_level_3}: ${v.title.substring(0, 60)}...`);
  });
  
  console.log('\n✅ You already have BERTopic clusters assigned!');
  console.log('Next step: Generate semantic names for these numeric topic IDs');
}

verifyExistingClusters().catch(console.error);