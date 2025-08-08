#!/usr/bin/env node

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyEnvelopeSmoothing() {
  console.log('=' + '='.repeat(60));
  console.log('APPLYING 7-DAY SMOOTHING TO PERFORMANCE ENVELOPES');
  console.log('=' + '='.repeat(60));
  
  // First, fetch all raw envelope data
  console.log('\n📊 Fetching raw envelope data from view_snapshots...');
  
  const { data: rawData, error: fetchError } = await supabase.rpc('calculate_raw_envelopes');
  
  if (fetchError) {
    // If RPC doesn't exist, we'll do it manually
    console.log('RPC not found, calculating manually...');
    
    // Fetch all snapshots (need to handle pagination)
    let allSnapshots = [];
    let offset = 0;
    const limit = 50000;
    
    while (true) {
      const { data: snapshots, error: snapshotError } = await supabase
        .from('view_snapshots')
        .select('days_since_published, view_count')
        .gte('days_since_published', 0)
        .lte('days_since_published', 3650)
        .not('view_count', 'is', null)
        .range(offset, offset + limit - 1);
      
      if (snapshotError) {
        console.error('Error fetching snapshots:', snapshotError);
        return;
      }
      
      if (!snapshots || snapshots.length === 0) break;
      
      allSnapshots = allSnapshots.concat(snapshots);
      process.stdout.write(`\r  Fetched ${allSnapshots.length.toLocaleString()} snapshots...`);
      
      if (snapshots.length < limit) break;
      offset += limit;
    }
    
    const snapshots = allSnapshots;
    
    console.log(`✅ Fetched ${snapshots.length.toLocaleString()} snapshots`);
    
    // Group by day and calculate percentiles
    const dayGroups = {};
    snapshots.forEach(s => {
      if (!dayGroups[s.days_since_published]) {
        dayGroups[s.days_since_published] = [];
      }
      dayGroups[s.days_since_published].push(s.view_count);
    });
    
    // Calculate percentiles for each day
    const envelopeData = [];
    for (const [day, views] of Object.entries(dayGroups)) {
      if (views.length < 10) continue; // Skip days with too few samples
      
      views.sort((a, b) => a - b);
      const percentile = (p) => {
        const index = Math.ceil(views.length * p) - 1;
        return views[Math.max(0, Math.min(index, views.length - 1))];
      };
      
      envelopeData.push({
        day: parseInt(day),
        p10: percentile(0.10),
        p25: percentile(0.25),
        p50: percentile(0.50),
        p75: percentile(0.75),
        p90: percentile(0.90),
        count: views.length
      });
    }
    
    envelopeData.sort((a, b) => a.day - b.day);
    console.log(`📈 Calculated percentiles for ${envelopeData.length} days`);
    
    // Apply 7-day smoothing
    console.log('\n🔄 Applying 7-day rolling average smoothing...');
    
    const smoothedData = envelopeData.map((current, index) => {
      // Get window of ±3 days
      const windowStart = Math.max(0, index - 3);
      const windowEnd = Math.min(envelopeData.length - 1, index + 3);
      const window = envelopeData.slice(windowStart, windowEnd + 1);
      
      // Calculate averages
      const avg = (key) => {
        const sum = window.reduce((acc, d) => acc + d[key], 0);
        return Math.round(sum / window.length);
      };
      
      return {
        day_since_published: current.day,
        p10_views: avg('p10'),
        p25_views: avg('p25'),
        p50_views: avg('p50'),
        p75_views: avg('p75'),
        p90_views: avg('p90'),
        sample_count: current.count
      };
    });
    
    console.log('✅ Smoothing complete');
    
    // Update database in batches
    console.log('\n💾 Updating performance_envelopes table...');
    
    const batchSize = 100;
    for (let i = 0; i < smoothedData.length; i += batchSize) {
      const batch = smoothedData.slice(i, i + batchSize);
      
      // Use upsert to update existing records
      const { error: updateError } = await supabase
        .from('performance_envelopes')
        .upsert(batch, { 
          onConflict: 'day_since_published',
          ignoreDuplicates: false 
        });
      
      if (updateError) {
        console.error(`Error updating batch ${i / batchSize + 1}:`, updateError);
        return;
      }
      
      process.stdout.write(`\r  Updated ${Math.min(i + batchSize, smoothedData.length)} / ${smoothedData.length} days`);
    }
    
    console.log('\n✅ Database updated successfully!');
    
    // Show sample of changes
    console.log('\n📊 Sample of smoothed values (Day 7):');
    const day7 = smoothedData.find(d => d.day_since_published === 7);
    if (day7) {
      console.log(`  P10: ${day7.p10_views.toLocaleString()} views`);
      console.log(`  P25: ${day7.p25_views.toLocaleString()} views`);
      console.log(`  P50: ${day7.p50_views.toLocaleString()} views (median)`);
      console.log(`  P75: ${day7.p75_views.toLocaleString()} views`);
      console.log(`  P90: ${day7.p90_views.toLocaleString()} views`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('SMOOTHING APPLIED SUCCESSFULLY!');
    console.log('Next step: Run bulk update to recalculate all video scores');
    console.log('Command: node scripts/bulk_update_video_scores.js');
    console.log('=' + '='.repeat(60));
  }
}

// Run the smoothing
applyEnvelopeSmoothing().catch(console.error);