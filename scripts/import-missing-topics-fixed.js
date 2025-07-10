#!/usr/bin/env node

/**
 * Import topic assignments ONLY for videos that don't have them yet
 * Fixed to work with actual BERTopic file structure
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

class MissingTopicImporter {
  constructor() {
    this.bertopicFile = '/Users/brandoncullum/video-scripter/exports/multi-level-bertopic-results-2025-07-10_11-57-57.json';
    this.embeddingsFile = '/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json';
    this.videoAssignments = new Map();
    this.missingVideoIds = [];
  }

  async loadVideoAssignments() {
    console.log('📂 Loading BERTopic results and video mappings...');
    
    // Load BERTopic results
    const bertopicData = JSON.parse(fs.readFileSync(this.bertopicFile, 'utf8'));
    const level1Topics = bertopicData['Level 1 - Broad Domains'].topics;
    const level2Topics = bertopicData['Level 2 - Niches'].topics;
    const level3Topics = bertopicData['Level 3 - Micro Topics'].topics;
    
    console.log(`   Found ${level1Topics.length} topic assignments`);
    
    // Load embeddings file to get video IDs in same order
    const embeddingsData = JSON.parse(fs.readFileSync(this.embeddingsFile, 'utf8'));
    
    // Check if it's an array or object
    let videoData;
    if (Array.isArray(embeddingsData)) {
      videoData = embeddingsData;
    } else if (embeddingsData.videos) {
      videoData = embeddingsData.videos;
    } else {
      // It might be an object with video IDs as keys
      videoData = Object.values(embeddingsData);
    }
    
    console.log(`   Found ${videoData.length} videos in embeddings file`);
    
    if (videoData.length !== level1Topics.length) {
      console.error(`❌ Mismatch: ${videoData.length} videos vs ${level1Topics.length} topics`);
      return false;
    }
    
    // Build assignment map
    for (let i = 0; i < videoData.length; i++) {
      const video = videoData[i];
      const videoId = video.id || video.video_id;
      
      if (videoId) {
        this.videoAssignments.set(videoId, {
          level_1_topic: level1Topics[i],
          level_2_topic: level2Topics[i],
          level_3_topic: level3Topics[i]
        });
      }
    }
    
    console.log(`✅ Loaded assignments for ${this.videoAssignments.size} videos`);
    return true;
  }

  async findMissingAssignments() {
    console.log('🔍 Finding videos that need topic assignments...');
    
    const { data: missingVideos, error } = await supabase
      .from('videos')
      .select('id')
      .is('topic_level_1', null);
    
    if (error) {
      throw new Error(`Failed to find missing videos: ${error.message}`);
    }
    
    this.missingVideoIds = missingVideos.map(v => v.id);
    console.log(`   Found ${this.missingVideoIds.length} videos without topic assignments`);
    
    // Filter assignments to only include missing videos
    const filteredAssignments = new Map();
    let foundCount = 0;
    
    for (const videoId of this.missingVideoIds) {
      if (this.videoAssignments.has(videoId)) {
        filteredAssignments.set(videoId, this.videoAssignments.get(videoId));
        foundCount++;
      }
    }
    
    this.videoAssignments = filteredAssignments;
    console.log(`✅ Found BERTopic assignments for ${foundCount} of ${this.missingVideoIds.length} missing videos`);
    
    if (foundCount === 0) {
      console.log('🎉 No missing assignments to import!');
      return false;
    }
    
    return true;
  }

  async batchUpdateMissingTopics() {
    console.log('🔄 Updating missing topic assignments...');
    
    const assignments = Array.from(this.videoAssignments.entries()).map(([videoId, topics]) => ({
      video_id: videoId,
      ...topics
    }));
    
    const batchSize = 1000;
    let updated = 0;
    let errors = 0;
    
    for (let i = 0; i < assignments.length; i += batchSize) {
      const batch = assignments.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(assignments.length / batchSize);
      
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
      
      // Show a few errors if any
      const errorResults = results.filter(r => !r.success).slice(0, 3);
      if (errorResults.length > 0) {
        console.log(`   Sample errors: ${errorResults.map(r => r.error).join(', ')}`);
      }
    }
    
    console.log(`\n📊 Update complete: ${updated} updated, ${errors} errors`);
  }

  async verifyResults() {
    console.log('\n🔍 Verifying final results...');
    
    const { data: stats, error } = await supabase
      .from('videos')
      .select('topic_level_1')
      .not('topic_level_1', 'is', null);
    
    if (error) {
      console.error('❌ Error checking stats:', error.message);
      return;
    }
    
    console.log(`📈 Total videos with topic assignments: ${stats.length}`);
    
    const { data: remaining, error: remainingError } = await supabase
      .from('videos')
      .select('id')
      .is('topic_level_1', null);
    
    if (!remainingError) {
      console.log(`📋 Videos still missing assignments: ${remaining.length}`);
    }
  }

  async run() {
    console.log('🚀 Starting Missing Topic Assignment Import\n');
    
    try {
      const loaded = await this.loadVideoAssignments();
      if (!loaded) return;
      
      const hasWork = await this.findMissingAssignments();
      
      if (hasWork) {
        await this.batchUpdateMissingTopics();
      }
      
      await this.verifyResults();
      
    } catch (error) {
      console.error('❌ Import failed:', error.message);
    }
  }
}

const importer = new MissingTopicImporter();
importer.run();