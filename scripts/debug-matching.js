#!/usr/bin/env node

const fs = require('fs');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugMatching() {
  console.log('🔍 Debugging title matching...');
  
  // Get first 10 CSV results
  const csvResults = [];
  await new Promise((resolve) => {
    fs.createReadStream('cluster_results_20250708_143617.csv')
      .pipe(csv())
      .on('data', (row) => {
        if (csvResults.length < 10) {
          csvResults.push({
            title: row.title,
            cluster: parseInt(row.cluster),
            video_id: row.video_id
          });
        }
      })
      .on('end', resolve);
  });
  
  console.log('\nFirst 10 CSV entries:');
  csvResults.forEach((r, i) => {
    console.log(`${i + 1}. "${r.title}" -> Cluster ${r.cluster}`);
  });
  
  // Get first 10 database videos
  const { data: dbVideos, error } = await supabase
    .from('videos')
    .select('id, title, channel_name')
    .limit(10);
  
  if (error) {
    console.error('Database error:', error);
    return;
  }
  
  console.log('\nFirst 10 database videos:');
  dbVideos.forEach((v, i) => {
    console.log(`${i + 1}. "${v.title}" (${v.channel_name})`);
  });
  
  // Check for exact matches
  console.log('\nChecking for matches:');
  csvResults.forEach(csvVideo => {
    const dbMatch = dbVideos.find(dbVideo => 
      dbVideo.title.trim().toLowerCase() === csvVideo.title.trim().toLowerCase()
    );
    
    if (dbMatch) {
      console.log(`✅ MATCH: "${csvVideo.title}" -> Cluster ${csvVideo.cluster}`);
    } else {
      console.log(`❌ NO MATCH: "${csvVideo.title}"`);
    }
  });
}

debugMatching().catch(console.error);