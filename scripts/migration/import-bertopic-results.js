#!/usr/bin/env node

/**
 * Import Multi-Level BERTopic Results to Database
 * Imports topic assignments and metadata from BERTopic analysis results
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class BERTopicImporter {
  constructor() {
    this.results = null;
    this.videoAssignments = null;
  }

  async loadResults() {
    console.log('📂 Loading BERTopic results...');
    
    // Load the latest results file
    const resultsFile = '/Users/brandoncullum/video-scripter/exports/multi-level-bertopic-results-2025-07-10_11-57-57.json';
    const videoAssignmentsFile = '/Users/brandoncullum/video-scripter/exports/videos-with-topic-assignments-2025-07-10_11-57-57.csv';
    
    if (!fs.existsSync(resultsFile)) {
      throw new Error(`Results file not found: ${resultsFile}`);
    }
    
    this.results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    console.log(`✅ Loaded results for ${Object.keys(this.results).length} levels`);
    
    // Load video assignments if CSV exists
    if (fs.existsSync(videoAssignmentsFile)) {
      console.log('📊 Loading video topic assignments...');
      // We'll parse this if needed, but the JSON results contain topic assignments too
    }
  }

  async importTopicMetadata() {
    console.log('🏷️  Importing topic metadata...');
    
    let totalTopics = 0;
    
    for (const [levelName, levelData] of Object.entries(this.results)) {
      console.log(`\n📋 Processing ${levelName}...`);
      
      // Extract level number from name
      let level;
      if (levelName.includes('Level 1')) level = 1;
      else if (levelName.includes('Level 2')) level = 2;
      else if (levelName.includes('Level 3')) level = 3;
      else continue;
      
      const topicMetadata = [];
      
      // Process each topic
      if (levelData.topic_info) {
        for (const topic of levelData.topic_info) {
          const topicId = topic.Topic;
          const videoCount = topic.Count;
          
          // Get keywords for this topic
          const keywords = levelData.top_words_per_topic[topicId] || [];
          
          topicMetadata.push({
            level,
            topic_id: topicId,
            keywords,
            video_count: videoCount
          });
        }
      }
      
      console.log(`   📊 Importing ${topicMetadata.length} topics for level ${level}...`);
      
      // Batch insert topic metadata
      if (topicMetadata.length > 0) {
        const { error } = await supabase
          .from('topic_categories')
          .upsert(topicMetadata, { 
            onConflict: 'level,topic_id',
            ignoreDuplicates: false 
          });
        
        if (error) {
          console.error(`❌ Error importing level ${level} metadata:`, error);
        } else {
          console.log(`✅ Imported ${topicMetadata.length} topics for level ${level}`);
          totalTopics += topicMetadata.length;
        }
      }
    }
    
    console.log(`\n🎉 Total topics imported: ${totalTopics}`);
  }

  async importVideoAssignments() {
    console.log('🎬 Importing video topic assignments...');
    
    // Extract video assignments from results
    const videoUpdates = [];
    
    for (const [levelName, levelData] of Object.entries(this.results)) {
      let level;
      if (levelName.includes('Level 1')) level = 1;
      else if (levelName.includes('Level 2')) level = 2;
      else if (levelName.includes('Level 3')) level = 3;
      else continue;
      
      console.log(`\n📋 Processing video assignments for ${levelName}...`);
      
      if (levelData.topics && Array.isArray(levelData.topics)) {
        // Process each video's topic assignment
        levelData.topics.forEach((topicId, index) => {
          // We need to match this with video IDs - this requires the video order from our analysis
          // For now, we'll create the structure and handle the mapping
          
          if (!videoUpdates[index]) {
            videoUpdates[index] = {};
          }
          
          videoUpdates[index][`topic_level_${level}`] = topicId;
        });
      }
    }
    
    console.log(`📊 Prepared assignments for ${videoUpdates.length} videos`);
    
    // Note: We need the video IDs in the same order as the BERTopic analysis
    // This would require either:
    // 1. Loading the original dataset used for analysis
    // 2. Using the CSV output with video assignments
    // 3. Matching by title (less reliable)
    
    console.log('⚠️  Video assignment import requires video ID mapping.');
    console.log('📝 Recommend using the CSV output for reliable video-topic mapping.');
    
    return videoUpdates.length;
  }

  async importFromCSV() {
    console.log('📊 Importing video assignments from CSV...');
    
    const csvFile = '/Users/brandoncullum/video-scripter/exports/videos-with-topic-assignments-2025-07-10_11-57-57.csv';
    
    if (!fs.existsSync(csvFile)) {
      console.log('⚠️  CSV file not found, skipping video assignments');
      return;
    }
    
    // First, get all valid video IDs from database
    console.log('📋 Fetching valid video IDs from database...');
    const { data: validVideos } = await supabase
      .from('videos')
      .select('id');
    
    const validVideoIds = new Set(validVideos?.map(v => v.id) || []);
    console.log(`📊 Found ${validVideoIds.size} valid video IDs in database`);
    
    // Read CSV and parse
    const csvContent = fs.readFileSync(csvFile, 'utf8');
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',');
    
    console.log(`📋 CSV headers: ${headers.join(', ')}`);
    
    // Find topic assignment columns
    const levelColumns = {
      1: headers.findIndex(h => h.includes('level_1') || h.includes('broad_domains')),
      2: headers.findIndex(h => h.includes('level_2') || h.includes('niches')), 
      3: headers.findIndex(h => h.includes('level_3') || h.includes('micro_topics'))
    };
    
    const idColumn = headers.findIndex(h => h === 'id' || h === 'video_id');
    
    if (idColumn === -1) {
      console.error('❌ No video ID column found in CSV');
      return;
    }
    
    console.log(`📊 Found topic columns: Level 1=${levelColumns[1]}, Level 2=${levelColumns[2]}, Level 3=${levelColumns[3]}`);
    
    // Parse all valid updates first
    console.log('🔍 Parsing CSV and filtering valid video IDs...');
    const allUpdates = [];
    let validCount = 0;
    let invalidCount = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      const values = line.split(',');
      const videoId = values[idColumn]?.replace(/"/g, '');
      
      if (!videoId || !validVideoIds.has(videoId)) {
        invalidCount++;
        continue;
      }
      
      const update = { id: videoId };
      
      // Add topic assignments if columns exist
      for (const [level, colIndex] of Object.entries(levelColumns)) {
        if (colIndex !== -1 && values[colIndex]) {
          const topicId = parseInt(values[colIndex]);
          if (!isNaN(topicId)) {
            update[`topic_level_${level}`] = topicId;
          }
        }
      }
      
      if (Object.keys(update).length > 1) { // More than just ID
        allUpdates.push(update);
        validCount++;
      }
    }
    
    console.log(`📊 Found ${validCount} valid updates, ${invalidCount} invalid/missing IDs`);
    
    // Process in optimized batches using upsert
    const batchSize = 1000;
    let successful = 0;
    
    for (let i = 0; i < allUpdates.length; i += batchSize) {
      const batch = allUpdates.slice(i, i + batchSize);
      
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allUpdates.length/batchSize)}: ${batch.length} videos...`);
      
      // Update each video individually to avoid constraint issues
      let batchSuccessful = 0;
      for (const update of batch) {
        const { id, ...updateData } = update;
        const { error, count } = await supabase
          .from('videos')
          .update(updateData)
          .eq('id', id);
        
        if (!error && count > 0) {
          batchSuccessful++;
        }
      }
      
      successful += batchSuccessful;
      console.log(`✅ Updated ${batchSuccessful} videos`);
    }
    
    console.log(`\n🎉 Video assignment import complete:`);
    console.log(`   📊 Valid updates: ${validCount}`);
    console.log(`   ✅ Successfully updated: ${successful} videos`);
    console.log(`   ⚠️  Skipped invalid IDs: ${invalidCount}`);
  }

  async verifyImport() {
    console.log('\n🔍 Verifying import...');
    
    // Check topic metadata
    const { data: topicCounts } = await supabase
      .from('topic_categories')
      .select('level')
      .then(result => {
        if (result.data) {
          const counts = {};
          result.data.forEach(row => {
            counts[row.level] = (counts[row.level] || 0) + 1;
          });
          return { data: counts };
        }
        return result;
      });
    
    if (topicCounts) {
      console.log('📊 Topic metadata counts:');
      for (const [level, count] of Object.entries(topicCounts)) {
        console.log(`   Level ${level}: ${count} topics`);
      }
    }
    
    // Check video assignments
    for (let level = 1; level <= 3; level++) {
      const { count } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .not(`topic_level_${level}`, 'is', null);
      
      console.log(`📹 Videos with Level ${level} topics: ${count}`);
    }
    
    // Sample some topic assignments
    const { data: sampleTopics } = await supabase
      .from('topic_categories')
      .select('level, topic_id, keywords, video_count')
      .order('video_count', { ascending: false })
      .limit(5);
    
    if (sampleTopics) {
      console.log('\n🔝 Top topics by video count:');
      sampleTopics.forEach(topic => {
        console.log(`   Level ${topic.level}, Topic ${topic.topic_id}: ${topic.keywords?.slice(0, 3).join(', ')} (${topic.video_count} videos)`);
      });
    }
  }

  async run() {
    try {
      console.log('🚀 Starting BERTopic Results Import\n');
      
      await this.loadResults();
      await this.importTopicMetadata();
      
      // Try CSV import for video assignments
      await this.importFromCSV();
      
      await this.verifyImport();
      
      console.log('\n✅ Import completed successfully!');
      console.log('\n📋 Next steps:');
      console.log('   1. Run Claude Code analysis to generate topic names');
      console.log('   2. Update topic_categories.name column with meaningful names');
      console.log('   3. Integrate topic filtering into video analysis UI');
      
    } catch (error) {
      console.error('❌ Import failed:', error);
      process.exit(1);
    }
  }
}

// Run the importer
const importer = new BERTopicImporter();
importer.run();