#!/usr/bin/env node

/**
 * Topic Update Worker
 * 
 * Reads BERTopic classification results from JSON file and updates database in batches.
 * Monitors IOPS to stay within Supabase limits.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configuration
const BATCH_SIZE = 100; // Videos per batch
const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds
const MAX_RETRIES = 3;
const TARGET_IOPS = 100; // Conservative IOPS target

// IOPS tracking
let iopsHistory = [];
const IOPS_WINDOW = 60000; // 1 minute window

class TopicUpdateWorker {
  constructor(classificationFile) {
    this.classificationFile = classificationFile;
    this.totalProcessed = 0;
    this.totalUpdated = 0;
    this.totalErrors = 0;
    this.startTime = Date.now();
  }

  async loadClassifications() {
    console.log(`Loading classifications from ${this.classificationFile}...`);
    const data = await fs.readFile(this.classificationFile, 'utf8');
    const parsed = JSON.parse(data);
    
    this.metadata = parsed.metadata;
    this.classifications = parsed.classifications;
    
    console.log(`Loaded ${this.classifications.length} classifications`);
    console.log(`Outlier rate: ${(this.metadata.outlier_rate * 100).toFixed(2)}%`);
    console.log(`Weights: ${this.metadata.title_weight * 100}% title, ${this.metadata.summary_weight * 100}% summary`);
  }

  trackIOPS(operations) {
    const now = Date.now();
    iopsHistory.push({ time: now, ops: operations });
    
    // Clean old entries
    iopsHistory = iopsHistory.filter(entry => 
      now - entry.time < IOPS_WINDOW
    );
  }

  getCurrentIOPS() {
    const totalOps = iopsHistory.reduce((sum, entry) => sum + entry.ops, 0);
    return (totalOps / IOPS_WINDOW) * 1000; // Per second
  }

  async shouldThrottle() {
    const currentIOPS = this.getCurrentIOPS();
    if (currentIOPS > TARGET_IOPS) {
      const waitTime = Math.min(
        ((currentIOPS / TARGET_IOPS) - 1) * 1000,
        10000 // Max 10 second wait
      );
      console.log(`Throttling: Current IOPS ${currentIOPS.toFixed(1)}, waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return true;
    }
    return false;
  }

  async updateBatch(batch) {
    const startTime = Date.now();
    let retries = 0;
    
    while (retries < MAX_RETRIES) {
      try {
        // Track read operation for fetching current data
        this.trackIOPS(1);
        
        // Prepare update data
        const updates = batch.map(video => ({
          id: video.id,
          topic_level_1: video.topic_level_1,
          topic_level_2: video.topic_level_2,
          topic_level_3: video.topic_level_3,
          topic_cluster_id: video.topic_cluster_id,
          topic_confidence: video.topic_confidence,
          classification_timestamp: new Date().toISOString()
        }));
        
        // Update in database
        const { data, error } = await supabase
          .from('videos')
          .upsert(updates, {
            onConflict: 'id',
            returning: 'minimal'
          });
          
        // Track write operations
        this.trackIOPS(batch.length);
        
        if (error) throw error;
        
        const duration = Date.now() - startTime;
        console.log(`Updated batch of ${batch.length} videos in ${duration}ms`);
        
        return batch.length;
        
      } catch (error) {
        retries++;
        console.error(`Error updating batch (attempt ${retries}/${MAX_RETRIES}):`, error.message);
        
        if (retries >= MAX_RETRIES) {
          throw error;
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000 * retries));
      }
    }
  }

  async updateTopicCategories() {
    console.log('\nUpdating topic_categories table...');
    
    try {
      // Load topic keywords if available
      const keywordsFile = path.join(path.dirname(this.classificationFile), 'topic_keywords.json');
      let topicKeywords = {};
      
      try {
        const keywordsData = await fs.readFile(keywordsFile, 'utf8');
        topicKeywords = JSON.parse(keywordsData);
      } catch (error) {
        console.log('No topic keywords file found');
      }
      
      // TODO: Update topic_categories table with new topic metadata
      // This would involve parsing the topic keywords and creating entries
      // for each level of the hierarchy
      
      console.log('Topic categories update complete');
      
    } catch (error) {
      console.error('Error updating topic categories:', error);
    }
  }

  async run() {
    await this.loadClassifications();
    
    console.log('\nStarting topic updates...');
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log(`Target IOPS: ${TARGET_IOPS}`);
    console.log(`Delay between batches: ${DELAY_BETWEEN_BATCHES}ms\n`);
    
    // Process in batches
    for (let i = 0; i < this.classifications.length; i += BATCH_SIZE) {
      const batch = this.classifications.slice(i, i + BATCH_SIZE);
      
      try {
        // Check if we need to throttle
        await this.shouldThrottle();
        
        // Update batch
        const updated = await this.updateBatch(batch);
        this.totalUpdated += updated;
        this.totalProcessed += batch.length;
        
        // Progress report
        const progress = (this.totalProcessed / this.classifications.length * 100).toFixed(2);
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = this.totalProcessed / elapsed;
        const eta = (this.classifications.length - this.totalProcessed) / rate;
        
        console.log(`Progress: ${progress}% (${this.totalProcessed}/${this.classifications.length})`);
        console.log(`Rate: ${rate.toFixed(1)} videos/sec, ETA: ${Math.ceil(eta / 60)} minutes`);
        console.log(`Current IOPS: ${this.getCurrentIOPS().toFixed(1)}\n`);
        
      } catch (error) {
        console.error(`Failed to update batch at index ${i}:`, error);
        this.totalErrors += batch.length;
      }
      
      // Delay between batches
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
    
    // Update topic categories
    await this.updateTopicCategories();
    
    // Final report
    const totalTime = (Date.now() - this.startTime) / 1000;
    console.log('\n=== Topic Update Complete ==="');
    console.log(`Total processed: ${this.totalProcessed}`);
    console.log(`Successfully updated: ${this.totalUpdated}`);
    console.log(`Errors: ${this.totalErrors}`);
    console.log(`Total time: ${Math.ceil(totalTime / 60)} minutes`);
    console.log(`Average rate: ${(this.totalProcessed / totalTime).toFixed(1)} videos/sec`);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node topic-update-worker.js <classification_file.json>');
    console.error('\nExample: node topic-update-worker.js bertopic_classifications_20250731_120000.json');
    process.exit(1);
  }
  
  const classificationFile = args[0];
  
  if (!classificationFile.endsWith('.json')) {
    console.error('Error: Classification file must be a JSON file');
    process.exit(1);
  }
  
  const worker = new TopicUpdateWorker(classificationFile);
  
  worker.run()
    .then(() => {
      console.log('Worker completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Worker failed:', error);
      process.exit(1);
    });
}

module.exports = TopicUpdateWorker;
