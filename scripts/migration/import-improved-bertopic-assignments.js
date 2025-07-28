#!/usr/bin/env node

/**
 * Import improved BERTopic video assignments to replace old topic assignments
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

class ImprovedBERTopicImporter {
  constructor() {
    this.csvFile = '/Users/brandoncullum/video-scripter/exports/improved-topic-assignments-2025-07-10_13-40-28.csv';
    this.videoAssignments = [];
    this.stats = {
      processed: 0,
      updated: 0,
      errors: 0,
      batches: 0
    };
  }

  async loadAssignments() {
    console.log('📂 Loading improved BERTopic video assignments...');
    
    return new Promise((resolve, reject) => {
      const assignments = [];
      
      fs.createReadStream(this.csvFile)
        .pipe(csv())
        .on('data', (row) => {
          // Extract the topic assignments
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
        })
        .on('end', () => {
          this.videoAssignments = assignments;
          console.log(`✅ Loaded ${assignments.length} video topic assignments`);
          resolve();
        })
        .on('error', reject);
    });
  }

  async updateVideoTopics() {
    console.log('🔄 Updating video topic assignments in batches...');
    
    const batchSize = 1000;
    const totalBatches = Math.ceil(this.videoAssignments.length / batchSize);
    
    for (let i = 0; i < this.videoAssignments.length; i += batchSize) {
      const batch = this.videoAssignments.slice(i, i + batchSize);
      this.stats.batches++;
      
      console.log(`   Processing batch ${this.stats.batches}/${totalBatches} (${batch.length} videos)`);
      
      for (const assignment of batch) {
        try {
          // Update the videos table with improved topic assignments
          const { error, count } = await supabase
            .from('videos')
            .update({
              topic_level_1: assignment.level_1_topic,
              topic_level_2: assignment.level_2_topic,
              topic_level_3: assignment.level_3_topic,
              updated_at: new Date().toISOString()
            })
            .eq('id', assignment.video_id);
          
          if (error) {
            console.error(`❌ Error updating video ${assignment.video_id}:`, error.message);
            this.stats.errors++;
          } else {
            this.stats.updated++;
          }
          
          this.stats.processed++;
          
          // Progress indicator
          if (this.stats.processed % 5000 === 0) {
            console.log(`   Progress: ${this.stats.processed}/${this.videoAssignments.length} videos processed`);
          }
          
        } catch (error) {
          console.error(`❌ Exception updating video ${assignment.video_id}:`, error.message);
          this.stats.errors++;
        }
      }
      
      // Small delay between batches  
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async verifyResults() {
    console.log('\n🔍 Verifying improved topic assignments...');
    
    // Check Level 1 distribution
    const { data: level1Stats, error: level1Error } = await supabase
      .from('videos')
      .select('topic_level_1')
      .not('topic_level_1', 'is', null);
    
    if (level1Error) {
      console.error('❌ Error checking Level 1 stats:', level1Error.message);
      return;
    }
    
    const level1Distribution = {};
    level1Stats.forEach(video => {
      const topic = video.topic_level_1;
      level1Distribution[topic] = (level1Distribution[topic] || 0) + 1;
    });
    
    console.log('\n📊 Level 1 Topic Distribution (Improved):');
    const sortedLevel1 = Object.entries(level1Distribution)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);
    
    for (const [topicId, count] of sortedLevel1) {
      // Get topic name
      const { data: topicData } = await supabase
        .from('topic_categories')
        .select('name')
        .eq('level', 1)
        .eq('topic_id', parseInt(topicId))
        .single();
      
      const topicName = topicData?.name || 'Unknown';
      console.log(`   Topic ${topicId}: ${topicName} (${count} videos)`);
    }
    
    // Check total videos with assignments
    const { data: totalStats, error: totalError } = await supabase
      .from('videos')
      .select('id', { count: 'exact' })
      .not('topic_level_1', 'is', null);
    
    if (!totalError) {
      console.log(`\n📈 Total videos with improved topic assignments: ${totalStats.length}`);
    }
  }

  async run() {
    console.log('🚀 Starting Improved BERTopic Video Assignment Import\n');
    
    try {
      await this.loadAssignments();
      await this.updateVideoTopics();
      
      console.log('\n✅ Import complete!');
      console.log(`📊 Final Stats:`);
      console.log(`   Processed: ${this.stats.processed} videos`);
      console.log(`   Updated: ${this.stats.updated} videos`);
      console.log(`   Errors: ${this.stats.errors} videos`);
      console.log(`   Batches: ${this.stats.batches}`);
      
      await this.verifyResults();
      
    } catch (error) {
      console.error('❌ Import failed:', error.message);
    }
  }
}

// Run the importer
const importer = new ImprovedBERTopicImporter();
importer.run();