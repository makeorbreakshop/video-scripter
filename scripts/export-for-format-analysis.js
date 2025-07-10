#!/usr/bin/env node

/**
 * Export stratified video samples for format pattern analysis
 * Focuses on high-performing videos across different topics
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const outputDir = '/Users/brandoncullum/video-scripter/exports/format-analysis';

// Create output directory
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function exportTopPerformers() {
  console.log('📊 Exporting top performers for format analysis...\n');

  // First, let's understand the performance distribution
  console.log('1️⃣ Analyzing performance distribution...');
  
  const { data: stats } = await supabase
    .from('videos')
    .select('view_count')
    .order('view_count', { ascending: false })
    .limit(1000);

  const viewCounts = stats.map(v => v.view_count).filter(v => v > 0);
  const p90 = viewCounts[Math.floor(viewCounts.length * 0.1)];
  const p80 = viewCounts[Math.floor(viewCounts.length * 0.2)];
  const p50 = viewCounts[Math.floor(viewCounts.length * 0.5)];

  console.log(`   P90: ${p90.toLocaleString()} views (top 10%)`);
  console.log(`   P80: ${p80.toLocaleString()} views (top 20%)`);
  console.log(`   P50: ${p50.toLocaleString()} views (median)\n`);

  // Export top performers overall
  console.log('2️⃣ Exporting top 2000 performers overall...');
  const { data: topOverall } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      channel_title,
      view_count,
      published_at,
      topic_level_1,
      topic_level_2,
      topic_level_3
    `)
    .gte('view_count', p80)
    .order('view_count', { ascending: false })
    .limit(2000);

  // Export top performers by domain
  console.log('3️⃣ Exporting top performers by domain...');
  const topByDomain = [];
  
  for (let domain = 0; domain < 6; domain++) {
    const { data } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_title,
        view_count,
        published_at,
        topic_level_1,
        topic_level_2,
        topic_level_3
      `)
      .eq('topic_level_1', domain)
      .order('view_count', { ascending: false })
      .limit(200);
    
    if (data && data.length > 0) {
      topByDomain.push(...data);
      console.log(`   Domain ${domain}: ${data.length} videos`);
    }
  }

  // Export recent viral videos (last 6 months, high performance)
  console.log('\n4️⃣ Exporting recent viral videos...');
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  const { data: recentViral } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      channel_title,
      view_count,
      published_at,
      topic_level_1,
      topic_level_2,
      topic_level_3
    `)
    .gte('published_at', sixMonthsAgo.toISOString())
    .gte('view_count', p90)
    .order('view_count', { ascending: false })
    .limit(500);

  // Export bottom performers for anti-pattern analysis
  console.log('5️⃣ Exporting bottom performers for anti-patterns...');
  const { data: bottomPerformers } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      channel_title,
      view_count,
      published_at,
      topic_level_1,
      topic_level_2,
      topic_level_3
    `)
    .gt('view_count', 0)
    .lt('view_count', 1000)
    .order('view_count', { ascending: true })
    .limit(1000);

  // Save all exports
  const timestamp = new Date().toISOString().split('T')[0];
  
  const exports = {
    'top-2000-overall': topOverall || [],
    'top-by-domain': topByDomain || [],
    'recent-viral': recentViral || [],
    'bottom-performers': bottomPerformers || []
  };

  console.log('\n6️⃣ Saving export files...');
  for (const [name, data] of Object.entries(exports)) {
    const filename = `${outputDir}/${name}-${timestamp}.json`;
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`   ✅ ${name}: ${data?.length || 0} videos → ${filename}`);
  }

  // Create a combined sample for initial analysis
  console.log('\n7️⃣ Creating combined analysis sample...');
  const combined = {
    metadata: {
      exportDate: timestamp,
      totalVideos: (topOverall?.length || 0) + (recentViral?.length || 0),
      performanceThresholds: { p90, p80, p50 }
    },
    topPerformers: (topOverall || []).slice(0, 1000),
    recentViral: recentViral || [],
    antiPatterns: (bottomPerformers || []).slice(0, 500)
  };

  const analysisFile = `${outputDir}/format-analysis-sample-${timestamp}.json`;
  fs.writeFileSync(analysisFile, JSON.stringify(combined, null, 2));
  console.log(`\n✅ Analysis sample created: ${analysisFile}`);
  console.log(`   Total videos for analysis: ${combined.topPerformers.length + combined.recentViral.length + combined.antiPatterns.length}`);

  // Create a CSV for easy viewing
  console.log('\n8️⃣ Creating CSV for manual review...');
  const csvContent = [
    'Title,Views,Channel,Published,Domain,Category',
    ...(topOverall || []).slice(0, 500).map(v => 
      `"${v.title.replace(/"/g, '""')}",${v.view_count},"${v.channel_title}",${v.published_at.split('T')[0]},${v.topic_level_1},${v.topic_level_2}`
    )
  ].join('\n');

  fs.writeFileSync(`${outputDir}/top-500-titles-${timestamp}.csv`, csvContent);
  console.log(`   ✅ CSV created for manual review`);

  console.log('\n🎯 Export complete! Ready for format pattern analysis.');
  console.log('\nNext steps:');
  console.log('1. Analyze the JSON files to identify format patterns');
  console.log('2. Look for patterns like "X in Y minutes", "Top N", etc.');
  console.log('3. Compare patterns between high and low performers');
  console.log('4. Check if certain formats work better in specific domains');
}

exportTopPerformers().catch(console.error);