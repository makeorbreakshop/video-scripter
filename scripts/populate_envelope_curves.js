/**
 * Populate Performance Envelopes Table
 * Generates global growth curves from view snapshot data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function calculateGlobalCurves() {
  console.log('🚀 Calculating global performance curves...');
  
  const curves = [];
  
  // Calculate percentiles for each day 0-365 (initial implementation)
  for (let day = 0; day <= 365; day++) {
    console.log(`📊 Processing day ${day}...`);
    
    try {
      // Get view counts for this specific day
      const { data: snapshots, error } = await supabase
        .from('view_snapshots')
        .select('view_count')
        .eq('days_since_published', day)
        .not('view_count', 'is', null);
      
      if (error) {
        console.error(`❌ Error fetching day ${day}:`, error);
        continue;
      }
      
      if (!snapshots || snapshots.length < 30) {
        console.log(`⚠️ Skipping day ${day}: insufficient data (${snapshots?.length || 0} videos)`);
        continue;
      }
      
      // Extract view counts and sort
      const views = snapshots.map(s => s.view_count).sort((a, b) => a - b);
      const count = views.length;
      
      // Calculate percentiles
      const percentiles = {
        p10: views[Math.floor(count * 0.10)],
        p25: views[Math.floor(count * 0.25)],
        p50: views[Math.floor(count * 0.50)],
        p75: views[Math.floor(count * 0.75)],
        p90: views[Math.floor(count * 0.90)],
        p95: views[Math.floor(count * 0.95)]
      };
      
      curves.push({
        day_since_published: day,
        p10_views: percentiles.p10,
        p25_views: percentiles.p25,
        p50_views: percentiles.p50,
        p75_views: percentiles.p75,
        p90_views: percentiles.p90,
        p95_views: percentiles.p95,
        sample_count: count
      });
      
      console.log(`✅ Day ${day}: ${count} videos | p50=${percentiles.p50.toLocaleString()} views`);
      
    } catch (error) {
      console.error(`❌ Error processing day ${day}:`, error);
    }
  }
  
  console.log(`\n📈 Generated curves for ${curves.length} days`);
  return curves;
}

async function saveCurvesToDatabase(curves) {
  console.log('💾 Saving curves to database...');
  
  // Clear existing data
  const { error: deleteError } = await supabase
    .from('performance_envelopes')
    .delete()
    .neq('day_since_published', -1); // Delete all
  
  if (deleteError) {
    console.error('❌ Error clearing table:', deleteError);
    return;
  }
  
  // Insert new data in batches
  const batchSize = 100;
  let inserted = 0;
  
  for (let i = 0; i < curves.length; i += batchSize) {
    const batch = curves.slice(i, i + batchSize);
    
    const { error: insertError } = await supabase
      .from('performance_envelopes')
      .insert(batch);
    
    if (insertError) {
      console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, insertError);
      continue;
    }
    
    inserted += batch.length;
    console.log(`✅ Inserted batch ${i / batchSize + 1}/${Math.ceil(curves.length / batchSize)} (${inserted} total)`);
  }
  
  console.log(`🎉 Successfully saved ${inserted} performance curves!`);
}

async function main() {
  try {
    const curves = await calculateGlobalCurves();
    
    if (curves.length === 0) {
      console.log('❌ No curves generated - insufficient data');
      return;
    }
    
    await saveCurvesToDatabase(curves);
    
    // Show sample results
    console.log('\n📊 Sample curves generated:');
    curves.slice(0, 10).forEach(curve => {
      console.log(`Day ${curve.day_since_published}: p25=${curve.p25_views.toLocaleString()} | p50=${curve.p50_views.toLocaleString()} | p75=${curve.p75_views.toLocaleString()} (${curve.sample_count} videos)`);
    });
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

main().catch(console.error);