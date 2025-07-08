#!/usr/bin/env node

/**
 * Script to assign BERTopic clusters to videos in the database
 * 
 * This script:
 * 1. Reads the BERTopic results CSV file
 * 2. Matches videos by title to the database
 * 3. Updates the topic_cluster column in the videos table
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client with service role for database updates
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 100; // Process updates in batches

async function readBertopicResults() {
  return new Promise((resolve, reject) => {
    const results = [];
    const csvPath = path.join(__dirname, '..', 'cluster_results_20250708_143617.csv');
    
    console.log(`📊 Reading BERTopic results from: ${csvPath}`);
    
    if (!fs.existsSync(csvPath)) {
      reject(new Error(`BERTopic results file not found: ${csvPath}`));
      return;
    }
    
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        results.push({
          title: row.title,
          topic: parseInt(row.cluster),
          video_id: row.video_id,
          channel_name: row.channel_name
        });
      })
      .on('end', () => {
        console.log(`   Loaded ${results.length} BERTopic results`);
        resolve(results);
      })
      .on('error', reject);
  });
}

async function getVideosFromDatabase() {
  console.log('🔍 Fetching ALL videos from database...');
  
  let allVideos = [];
  let page = 0;
  const pageSize = 1000;
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, topic_cluster')
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    
    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }
    
    if (videos.length === 0) {
      break;
    }
    
    allVideos = allVideos.concat(videos);
    console.log(`   Fetched page ${page + 1}: ${videos.length} videos (total: ${allVideos.length})`);
    page++;
  }
  
  console.log(`   Found ${allVideos.length} total videos in database`);
  return allVideos;
}

function matchVideosByTitle(bertopicResults, databaseVideos) {
  console.log('🔄 Matching videos by ID...');
  
  const matches = [];
  const unmatched = [];
  
  // Create a map of video IDs to database videos for faster lookup
  const dbVideoMap = new Map();
  databaseVideos.forEach(video => {
    dbVideoMap.set(video.id, video);
  });
  
  bertopicResults.forEach(bertopicVideo => {
    const dbVideo = dbVideoMap.get(bertopicVideo.video_id);
    
    if (dbVideo) {
      matches.push({
        db_id: dbVideo.id,
        title: bertopicVideo.title,
        topic_cluster: bertopicVideo.topic,
        current_cluster: dbVideo.topic_cluster
      });
    } else {
      unmatched.push(bertopicVideo);
    }
  });
  
  console.log(`   Matched: ${matches.length} videos`);
  console.log(`   Unmatched: ${unmatched.length} videos`);
  
  return { matches, unmatched };
}

async function updateVideosClusters(matches) {
  console.log('💾 Updating video clusters in database...');
  
  // Filter out videos that already have the correct cluster
  const needsUpdate = matches.filter(match => match.current_cluster !== match.topic_cluster);
  
  if (needsUpdate.length === 0) {
    console.log('   All videos already have correct clusters assigned');
    return;
  }
  
  console.log(`   ${needsUpdate.length} videos need cluster updates`);
  
  let updated = 0;
  let errors = 0;
  
  // Process in batches
  for (let i = 0; i < needsUpdate.length; i += BATCH_SIZE) {
    const batch = needsUpdate.slice(i, i + BATCH_SIZE);
    
    console.log(`   Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(needsUpdate.length / BATCH_SIZE)}`);
    
    // Update each video in the batch
    for (const match of batch) {
      const { error } = await supabase
        .from('videos')
        .update({ topic_cluster: match.topic_cluster })
        .eq('id', match.db_id);
      
      if (error) {
        console.error(`   Error updating video ${match.db_id}: ${error.message}`);
        errors++;
      } else {
        updated++;
      }
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`   Updated: ${updated} videos`);
  console.log(`   Errors: ${errors} videos`);
}

async function generateSummaryReport(matches, unmatched) {
  console.log('📊 Generating summary report...');
  
  // Topic distribution
  const topicDistribution = {};
  matches.forEach(match => {
    topicDistribution[match.topic_cluster] = (topicDistribution[match.topic_cluster] || 0) + 1;
  });
  
  // Sort topics by count
  const sortedTopics = Object.entries(topicDistribution)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);
  
  console.log('\n📈 Top 10 Topic Clusters:');
  sortedTopics.forEach(([topic, count]) => {
    console.log(`   Topic ${topic}: ${count} videos`);
  });
  
  // Save detailed report
  const report = {
    summary: {
      total_bertopic_results: matches.length + unmatched.length,
      matched_videos: matches.length,
      unmatched_videos: unmatched.length,
      unique_topics: Object.keys(topicDistribution).length
    },
    topic_distribution: topicDistribution,
    unmatched_samples: unmatched.slice(0, 10).map(v => ({
      title: v.title,
      channel: v.channel_name,
      topic: v.topic
    }))
  };
  
  const reportPath = path.join(__dirname, '..', `cluster_assignment_report_${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n💾 Detailed report saved to: ${reportPath}`);
}

async function main() {
  try {
    console.log('🚀 Starting Topic Cluster Assignment');
    console.log('=' * 60);
    
    // Step 1: Read BERTopic results
    const bertopicResults = await readBertopicResults();
    
    // Step 2: Get videos from database
    const databaseVideos = await getVideosFromDatabase();
    
    // Step 3: Match videos by title
    const { matches, unmatched } = matchVideosByTitle(bertopicResults, databaseVideos);
    
    // Step 4: Update clusters in database
    await updateVideosClusters(matches);
    
    // Step 5: Generate summary report
    await generateSummaryReport(matches, unmatched);
    
    console.log('\n🎉 Topic Cluster Assignment Complete!');
    console.log('Next steps:');
    console.log('1. Review the generated report for assignment statistics');
    console.log('2. Test cluster-based queries in your application');
    console.log('3. Consider strategies for handling unmatched videos');
    
  } catch (error) {
    console.error('❌ Error during cluster assignment:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}