import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetAndRecalcWillTennyson() {
  console.log('Resetting Will Tennyson baselines to trigger recalculation...');
  
  // First, set all Will Tennyson baselines to NULL
  const { data: resetData, error: resetError } = await supabase
    .from('videos')
    .update({ 
      channel_baseline_at_publish: null,
      temporal_performance_score: null 
    })
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false);
  
  if (resetError) {
    console.error('Error resetting baselines:', resetError);
    return;
  }
  
  console.log('Baselines reset. Now triggering recalculation...');
  
  // Now trigger the batch processing function which will recalculate them properly
  const { data, error } = await supabase.rpc('trigger_temporal_baseline_processing', {
    batch_size: 500  // Process all at once
  });
  
  if (error) {
    console.error('Error triggering recalculation:', error);
    return;
  }
  
  console.log('Recalculation result:', data);
  
  // Verify the results - check for variety in baselines
  const { data: verification, error: verifyError } = await supabase
    .from('videos')
    .select('channel_baseline_at_publish, temporal_performance_score, title')
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false)
    .order('published_at', { ascending: true })
    .limit(20);
  
  if (!verifyError && verification) {
    console.log('\nSample of recalculated baselines (should vary over time):');
    verification.forEach(v => {
      const baseline = v.channel_baseline_at_publish ? 
        Math.round(v.channel_baseline_at_publish * 29742) : 'NULL';
      console.log(`  ${v.title.substring(0, 40)}... - Baseline: ${baseline} views, Score: ${v.temporal_performance_score?.toFixed(2) || 'NULL'}`);
    });
    
    // Check for unique baseline values
    const uniqueBaselines = new Set(verification.map(v => v.channel_baseline_at_publish));
    console.log(`\nUnique baseline values in sample: ${uniqueBaselines.size}`);
    if (uniqueBaselines.size === 1) {
      console.warn('⚠️  Warning: All baselines are the same! This needs further investigation.');
    } else {
      console.log('✅ Baselines vary properly!');
    }
  }
}

resetAndRecalcWillTennyson().catch(console.error);