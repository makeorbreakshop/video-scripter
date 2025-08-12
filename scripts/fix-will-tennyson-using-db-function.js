import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixWillTennysonWithDbFunction() {
  console.log('Recalculating Will Tennyson baselines using database function...');
  
  // Get all Will Tennyson video IDs
  const { data: videos, error: fetchError } = await supabase
    .from('videos')
    .select('id')
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false);
  
  if (fetchError) {
    console.error('Error fetching videos:', fetchError);
    return;
  }
  
  console.log(`Found ${videos.length} Will Tennyson videos to recalculate`);
  
  let updated = 0;
  let errors = 0;
  
  // Process in batches to avoid timeout
  const batchSize = 50;
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    
    for (const video of batch) {
      // Call the database function for each video
      const { data, error } = await supabase.rpc('calculate_video_channel_baseline', {
        video_id: video.id
      });
      
      if (error) {
        console.error(`Error calculating baseline for ${video.id}:`, error);
        errors++;
        continue;
      }
      
      // Update the video with the calculated baseline
      const baseline = parseFloat(data);
      const { error: updateError } = await supabase
        .from('videos')
        .update({ channel_baseline_at_publish: baseline })
        .eq('id', video.id);
      
      if (updateError) {
        console.error(`Error updating ${video.id}:`, updateError);
        errors++;
      } else {
        updated++;
      }
    }
    
    console.log(`Progress: ${Math.min(i + batchSize, videos.length)}/${videos.length} videos processed`);
  }
  
  console.log(`\nComplete! Updated ${updated} videos, ${errors} errors`);
  
  // Verify the results
  const { data: verification, error: verifyError } = await supabase
    .from('videos')
    .select('channel_baseline_at_publish')
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false)
    .order('channel_baseline_at_publish', { ascending: true })
    .limit(10);
  
  if (!verifyError && verification) {
    console.log('\nSample of baseline values (should vary):');
    verification.forEach(v => console.log(`  Baseline: ${v.channel_baseline_at_publish}`));
  }
  
  // Also recalculate temporal scores
  console.log('\nRecalculating temporal performance scores...');
  const { data: scoreUpdate, error: scoreError } = await supabase.rpc(
    'update_temporal_scores_for_channel',
    { channel: 'Will Tennyson' }
  );
  
  if (scoreError) {
    console.error('Error updating temporal scores:', scoreError);
  } else {
    console.log('Temporal scores updated successfully');
  }
}

fixWillTennysonWithDbFunction().catch(console.error);