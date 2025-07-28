#!/usr/bin/env node

/**
 * Import topic assignments ONLY for videos that still need them
 * Skips videos that already have assignments
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

class RemainingTopicImporter {
  constructor() {
    this.csvFile = '/Users/brandoncullum/video-scripter/exports/improved-topic-assignments-2025-07-10_13-40-28.csv';
    this.videoAssignments = [];
    this.alreadyAssigned = new Set();
  }

  async loadExistingAssignments() {
    console.log('🔍 Loading videos that already have assignments...');
    
    let allAssigned = [];
    let from = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data: batch, error } = await supabase
        .from('videos')
        .select('id')
        .not('topic_level_1', 'is', null)
        .range(from, from + batchSize - 1);
      
      if (error) {
        throw new Error(`Failed to load assigned videos: ${error.message}`);
      }
      
      if (!batch || batch.length === 0) break;
      
      allAssigned = allAssigned.concat(batch);
      from += batchSize;
      
      if (from % 10000 === 0) {
        console.log(`   Loaded ${allAssigned.length} assigned videos so far...`);
      }
      
      if (batch.length < batchSize) break;
    }
    
    allAssigned.forEach(v => this.alreadyAssigned.add(v.id));
    console.log(`   Found ${this.alreadyAssigned.size} videos already assigned`);
  }

  async loadAssignments() {
    console.log('📂 Loading BERTopic video assignments...');
    
    return new Promise((resolve, reject) => {
      const assignments = [];
      let rowCount = 0;
      let skipped = 0;
      
      fs.createReadStream(this.csvFile)
        .pipe(csv())
        .on('data', (row) => {
          rowCount++;
          const videoId = row.id;
          
          // Skip if already assigned
          if (this.alreadyAssigned.has(videoId)) {
            skipped++;
            return;
          }
          
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
            console.log(`   Processed ${rowCount} rows, ${assignments.length} new assignments, ${skipped} skipped...`);
          }
        })
        .on('end', () => {
          this.videoAssignments = assignments;
          console.log(`✅ Found ${assignments.length} NEW video assignments (${skipped} already assigned)`);
          resolve();
        })
        .on('error', reject);
    });
  }

  async updateRemainingTopics() {
    if (this.videoAssignments.length === 0) {
      console.log('🎉 All videos already have topic assignments!');
      return;
    }
    
    console.log(`🔄 Updating ${this.videoAssignments.length} remaining videos...`);
    
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
            return { success: false, error: error.message };
          }
          return { success: true };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      const results = await Promise.all(promises);
      const batchSuccess = results.filter(r => r.success).length;
      const batchErrors = results.filter(r => !r.success).length;
      
      updated += batchSuccess;
      errors += batchErrors;
      
      console.log(`   ✅ Batch ${batchNum}: ${batchSuccess} updated, ${batchErrors} errors`);
    }
    
    console.log(`\n📊 Update complete: ${updated} updated, ${errors} errors`);
  }

  async run() {
    console.log('🚀 Starting Remaining Topic Assignment Import\n');
    
    try {
      await this.loadExistingAssignments();
      await this.loadAssignments();
      await this.updateRemainingTopics();
      
    } catch (error) {
      console.error('❌ Import failed:', error.message);
    }
  }
}

const importer = new RemainingTopicImporter();
importer.run();