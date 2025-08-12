import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixWillTennysonMultipliers() {
  console.log('Converting Will Tennyson baselines from raw views to multipliers...');
  
  // First get all Will Tennyson videos
  const { data: videos, error: fetchError } = await supabase
    .from('videos')
    .select('id, channel_baseline_at_publish')
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false)
    .not('channel_baseline_at_publish', 'is', null);
  
  if (fetchError) {
    console.error('Error fetching videos:', fetchError);
    return;
  }
  
  console.log(`Found ${videos.length} Will Tennyson videos to update`);
  
  // Filter to only videos that need conversion (baseline > 100)
  const videosToUpdate = videos.filter(v => v.channel_baseline_at_publish > 100);
  console.log(`${videosToUpdate.length} videos need conversion`);
  
  if (videosToUpdate.length === 0) {
    console.log('No videos need updating');
    return;
  }
  
  // Update in batches of 100
  const batchSize = 100;
  let totalUpdated = 0;
  
  for (let i = 0; i < videosToUpdate.length; i += batchSize) {
    const batch = videosToUpdate.slice(i, i + batchSize);
    
    // Prepare updates
    const updates = batch.map(video => ({
      id: video.id,
      channel_baseline_at_publish: Math.min(
        video.channel_baseline_at_publish / 29742,
        99999.999  // Cap at max NUMERIC(8,3)
      )
    }));
    
    // Update each video in the batch
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('videos')
        .update({ channel_baseline_at_publish: update.channel_baseline_at_publish })
        .eq('id', update.id);
      
      if (updateError) {
        console.error(`Error updating video ${update.id}:`, updateError);
      } else {
        totalUpdated++;
      }
    }
    
    console.log(`Processed ${Math.min(i + batchSize, videosToUpdate.length)} / ${videosToUpdate.length} videos`);
  }
  
  console.log(`\nUpdate complete! Converted ${totalUpdated} videos from raw views to multipliers`);
  
  // Verify the results
  const { data: verification, error: verifyError } = await supabase
    .from('videos')
    .select('channel_baseline_at_publish')
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false)
    .not('channel_baseline_at_publish', 'is', null)
    .limit(5);
  
  if (!verifyError && verification) {
    console.log('\nSample of updated values (should all be < 100):');
    verification.forEach(v => console.log(`  Baseline: ${v.channel_baseline_at_publish}`));
  }
}

fixWillTennysonMultipliers().catch(console.error);