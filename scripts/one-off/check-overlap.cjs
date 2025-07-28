const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkOverlap() {
  // Load embeddings
  console.log('Loading embeddings file...');
  const embeddingData = JSON.parse(fs.readFileSync('exports/all-title-embeddings-from-db.json', 'utf8'));
  const embeddingIds = new Set(embeddingData.videos.map(v => v.id));
  console.log(`Found ${embeddingIds.size} videos with embeddings`);
  
  // Get all videos needing topics (remove limit)
  const allNeedingTopics = [];
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
    
    allNeedingTopics.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  
  const needsTopicIds = new Set(allNeedingTopics.map(v => v.id));
  console.log(`Found ${needsTopicIds.size} videos needing topics`);
  
  // Find overlap
  let overlap = 0;
  for (const id of embeddingIds) {
    if (needsTopicIds.has(id)) overlap++;
  }
  
  console.log(`\nOverlap: ${overlap} videos have embeddings AND need topics`);
  
  // Sample some overlapping videos
  if (overlap > 0) {
    console.log('\nSample overlapping videos:');
    let count = 0;
    for (const video of embeddingData.videos) {
      if (needsTopicIds.has(video.id)) {
        console.log(`- ${video.id}: ${video.title}`);
        count++;
        if (count >= 5) break;
      }
    }
  }
}

checkOverlap().catch(console.error);