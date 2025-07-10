#!/usr/bin/env node

/**
 * Export whatever videos are available (with or without topics) for format analysis
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

async function exportAvailableVideos() {
  console.log('📊 Exporting available videos for format analysis...\n');

  // Get top performers regardless of topic assignment
  console.log('1️⃣ Exporting top 2000 performers (with or without topics)...');
  const { data: topVideos, error } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      view_count,
      published_at
    `)
    .gt('view_count', 10000000) // 10M+ views
    .order('view_count', { ascending: false })
    .limit(2000);

  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }

  console.log(`   Found ${topVideos?.length || 0} high-performing videos`);

  // Get a mix of view counts for pattern discovery
  console.log('\n2️⃣ Getting stratified sample by view ranges...');
  
  const viewRanges = [
    { name: 'mega-viral', min: 100000000, max: null },      // 100M+
    { name: 'viral', min: 10000000, max: 100000000 },       // 10M-100M
    { name: 'high-performer', min: 1000000, max: 10000000 }, // 1M-10M
    { name: 'medium', min: 100000, max: 1000000 },          // 100K-1M
    { name: 'low', min: 1000, max: 100000 }                 // 1K-100K
  ];

  const stratifiedSample = [];
  
  for (const range of viewRanges) {
    let query = supabase
      .from('videos')
      .select('id, title, view_count, published_at')
      .gte('view_count', range.min)
      .order('view_count', { ascending: false })
      .limit(200);
      
    if (range.max) {
      query = query.lt('view_count', range.max);
    }
    
    const { data } = await query;
    
    if (data && data.length > 0) {
      stratifiedSample.push(...data.map(v => ({ ...v, performance_tier: range.name })));
      console.log(`   ${range.name}: ${data.length} videos`);
    }
  }

  const timestamp = new Date().toISOString().split('T')[0];
  
  // Save main analysis file
  const analysisData = {
    metadata: {
      exportDate: timestamp,
      totalVideos: topVideos.length + stratifiedSample.length
    },
    topPerformers: topVideos,
    stratifiedSample: stratifiedSample
  };

  const filename = `${outputDir}/format-discovery-data-${timestamp}.json`;
  fs.writeFileSync(filename, JSON.stringify(analysisData, null, 2));
  console.log(`\n✅ Saved analysis data: ${filename}`);

  // Create a titles-only file for pattern analysis
  console.log('\n3️⃣ Creating titles-only file for pattern discovery...');
  
  const allTitles = [
    ...topVideos.map(v => ({
      title: v.title,
      views: v.view_count
    })),
    ...stratifiedSample.map(v => ({
      title: v.title,
      views: v.view_count,
      tier: v.performance_tier
    }))
  ];

  // Remove duplicates
  const uniqueTitles = Array.from(
    new Map(allTitles.map(item => [item.title, item])).values()
  );

  const titlesFile = `${outputDir}/titles-for-analysis-${timestamp}.json`;
  fs.writeFileSync(titlesFile, JSON.stringify(uniqueTitles, null, 2));
  console.log(`   ✅ ${uniqueTitles.length} unique titles saved`);

  // Create CSV for quick viewing
  const csvContent = [
    'Title,Views',
    ...uniqueTitles
      .sort((a, b) => b.views - a.views)
      .slice(0, 1000)
      .map(v => `"${v.title.replace(/"/g, '""')}",${v.views}`)
  ].join('\n');

  fs.writeFileSync(`${outputDir}/top-1000-titles-${timestamp}.csv`, csvContent);
  console.log(`   ✅ CSV created for manual review`);

  console.log('\n🎯 Export complete! Files ready for format pattern discovery.');
}

exportAvailableVideos().catch(console.error);