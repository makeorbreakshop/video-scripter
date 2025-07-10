#!/usr/bin/env node

/**
 * Bulk import improved BERTopic video assignments using SQL
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import csv from 'csv-parser';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

class BulkBERTopicImporter {
  constructor() {
    this.csvFile = '/Users/brandoncullum/video-scripter/exports/improved-topic-assignments-2025-07-10_13-40-28.csv';
    this.videoAssignments = [];
  }

  async loadAssignments() {
    console.log('📂 Loading improved BERTopic video assignments...');
    
    return new Promise((resolve, reject) => {
      const assignments = [];
      let rowCount = 0;
      
      fs.createReadStream(this.csvFile)
        .pipe(csv())
        .on('data', (row) => {
          rowCount++;
          const videoId = row.id;
          const level1Topic = parseInt(row.level_1___broad_domains_topic);
          const level2Topic = parseInt(row.level_2___niches_topic);
          const level3Topic = parseInt(row.level_3___micro_topics_topic);
          
          if (videoId && !isNaN(level1Topic) && !isNaN(level2Topic) && !isNaN(level3Topic)) {
            assignments.push({
              video_id: videoId,
              level_1_topic: level1Topic,
              level_2_topic: level2Topic,
              level_3_topic: level3Topic
            });
          }
          
          if (rowCount % 10000 === 0) {
            console.log(`   Loaded ${rowCount} rows...`);
          }
        })
        .on('end', () => {
          this.videoAssignments = assignments;
          console.log(`✅ Loaded ${assignments.length} video topic assignments from ${rowCount} rows`);
          resolve();
        })
        .on('error', reject);
    });
  }

  async bulkUpdateTopics() {
    console.log('🔄 Performing bulk update using SQL...');
    
    // Create a temporary table approach for bulk update
    const chunkSize = 5000;
    let totalUpdated = 0;
    
    for (let i = 0; i < this.videoAssignments.length; i += chunkSize) {
      const chunk = this.videoAssignments.slice(i, i + chunkSize);
      const chunkNum = Math.floor(i / chunkSize) + 1;
      const totalChunks = Math.ceil(this.videoAssignments.length / chunkSize);
      
      console.log(`   Processing chunk ${chunkNum}/${totalChunks} (${chunk.length} videos)`);
      
      // Build VALUES clause for this chunk
      const values = chunk.map(assignment => 
        `('${assignment.video_id}', ${assignment.level_1_topic}, ${assignment.level_2_topic}, ${assignment.level_3_topic})`
      ).join(',\n');
      
      const sql = `
        WITH topic_updates(video_id, new_topic_1, new_topic_2, new_topic_3) AS (
          VALUES ${values}
        )
        UPDATE videos 
        SET 
          topic_level_1 = topic_updates.new_topic_1,
          topic_level_2 = topic_updates.new_topic_2,
          topic_level_3 = topic_updates.new_topic_3,
          updated_at = NOW()
        FROM topic_updates
        WHERE videos.id = topic_updates.video_id;
      `;
      
      try {
        const { error, count } = await supabase.rpc('exec_sql', { sql });
        
        if (error) {
          console.error(`❌ Error in chunk ${chunkNum}:`, error.message);
        } else {
          console.log(`✅ Updated chunk ${chunkNum} successfully`);
          totalUpdated += chunk.length;
        }
      } catch (error) {
        console.error(`❌ Exception in chunk ${chunkNum}:`, error.message);
      }
    }
    
    console.log(`\n📊 Bulk update complete: ${totalUpdated} videos processed`);
  }

  async simpleUpdate() {
    console.log('🔄 Using simple batch update approach...');
    
    const batchSize = 1000;
    let updated = 0;
    let errors = 0;
    
    for (let i = 0; i < this.videoAssignments.length; i += batchSize) {
      const batch = this.videoAssignments.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(this.videoAssignments.length / batchSize);
      
      console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} videos)`);
      
      const promises = batch.map(async (assignment) => {
        try {
          const { error } = await supabase
            .from('videos')
            .update({
              topic_level_1: assignment.level_1_topic,
              topic_level_2: assignment.level_2_topic,
              topic_level_3: assignment.level_3_topic,
              updated_at: new Date().toISOString()
            })
            .eq('id', assignment.video_id);
          
          if (error) {
            console.error(`❌ Error updating ${assignment.video_id}:`, error.message);
            return { success: false };
          }
          return { success: true };
        } catch (error) {
          console.error(`❌ Exception updating ${assignment.video_id}:`, error.message);
          return { success: false };
        }
      });
      
      const results = await Promise.all(promises);
      const batchSuccess = results.filter(r => r.success).length;
      const batchErrors = results.filter(r => !r.success).length;
      
      updated += batchSuccess;
      errors += batchErrors;
      
      console.log(`   ✅ Batch ${batchNum}: ${batchSuccess} updated, ${batchErrors} errors`);
      
      // Progress update
      if (batchNum % 5 === 0) {
        console.log(`   📊 Progress: ${updated} updated, ${errors} errors so far`);
      }
    }
    
    console.log(`\n📊 Simple update complete: ${updated} updated, ${errors} errors`);
  }

  async verifyResults() {
    console.log('\n🔍 Verifying topic assignments...');
    
    const { data: stats, error } = await supabase
      .from('videos')
      .select('topic_level_1')
      .not('topic_level_1', 'is', null);
    
    if (error) {
      console.error('❌ Error checking stats:', error.message);
      return;
    }
    
    const distribution = {};
    stats.forEach(video => {
      const topic = video.topic_level_1;
      distribution[topic] = (distribution[topic] || 0) + 1;
    });
    
    console.log('\n📊 Level 1 Topic Distribution:');
    const sorted = Object.entries(distribution)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);
    
    for (const [topicId, count] of sorted) {
      const { data: topicData } = await supabase
        .from('topic_categories')
        .select('name')
        .eq('level', 1)
        .eq('topic_id', parseInt(topicId))
        .single();
      
      const name = topicData?.name || 'Unknown';
      console.log(`   Topic ${topicId}: ${name} (${count} videos)`);
    }
    
    console.log(`\n📈 Total videos with topic assignments: ${stats.length}`);
  }

  async run() {
    console.log('🚀 Starting Bulk BERTopic Import\n');
    
    try {
      await this.loadAssignments();
      await this.simpleUpdate(); // Use simple approach first
      await this.verifyResults();
      
    } catch (error) {
      console.error('❌ Import failed:', error.message);
    }
  }
}

const importer = new BulkBERTopicImporter();
importer.run();