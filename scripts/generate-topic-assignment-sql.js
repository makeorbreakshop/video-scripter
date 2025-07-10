#!/usr/bin/env node

/**
 * Generate chunked SQL files for topic assignments
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

class SQLGenerator {
  constructor() {
    this.bertopicFile = '/Users/brandoncullum/video-scripter/exports/multi-level-bertopic-results-2025-07-10_11-57-57.json';
    this.outputDir = '/Users/brandoncullum/video-scripter/sql/topic-assignments/';
    this.chunkSize = 2000;
    this.videoAssignments = new Map();
    this.missingVideoIds = [];
  }

  async setup() {
    // Create output directory
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async loadBERTopicResults() {
    console.log('📂 Loading BERTopic results...');
    
    const data = JSON.parse(fs.readFileSync(this.bertopicFile, 'utf8'));
    
    // Check structure first
    console.log('🔍 Analyzing BERTopic file structure...');
    console.log('Top level keys:', Object.keys(data));
    
    // The file should have document_info for each level
    const level1 = data['Level 1 - Broad Domains'];
    const level2 = data['Level 2 - Niches']; 
    const level3 = data['Level 3 - Micro Topics'];
    
    if (!level1?.document_info) {
      console.error('❌ Could not find document_info in Level 1');
      console.log('Level 1 structure:', Object.keys(level1 || {}));
      return false;
    }
    
    console.log(`   Level 1: ${level1.document_info.length} assignments`);
    console.log(`   Level 2: ${level2?.document_info?.length || 0} assignments`);
    console.log(`   Level 3: ${level3?.document_info?.length || 0} assignments`);
    
    // Show sample to verify structure
    console.log('Sample Level 1 assignment:', level1.document_info[0]);
    
    // Build assignment map
    for (let i = 0; i < level1.document_info.length; i++) {
      const doc1 = level1.document_info[i];
      const doc2 = level2?.document_info?.[i];
      const doc3 = level3?.document_info?.[i];
      
      const videoId = doc1.Document;
      if (videoId && typeof videoId === 'string') {
        this.videoAssignments.set(videoId, {
          level_1_topic: doc1.Topic,
          level_2_topic: doc2?.Topic || null,
          level_3_topic: doc3?.Topic || null
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
      console.log('🎉 No missing assignments to generate!');
      return false;
    }
    
    return true;
  }

  generateSQLChunks() {
    console.log('📝 Generating SQL chunks...');
    
    const assignments = Array.from(this.videoAssignments.entries()).map(([videoId, topics]) => ({
      video_id: videoId,
      ...topics
    }));
    
    const totalChunks = Math.ceil(assignments.length / this.chunkSize);
    console.log(`   Creating ${totalChunks} SQL files with ${this.chunkSize} assignments each`);
    
    for (let i = 0; i < assignments.length; i += this.chunkSize) {
      const chunk = assignments.slice(i, i + this.chunkSize);
      const chunkNum = Math.floor(i / this.chunkSize) + 1;
      
      // Build VALUES clause
      const values = chunk.map(assignment => 
        `('${assignment.video_id}', ${assignment.level_1_topic}, ${assignment.level_2_topic}, ${assignment.level_3_topic})`
      ).join(',\n  ');
      
      const sql = `-- Topic Assignment Chunk ${chunkNum}/${totalChunks}
-- ${chunk.length} video assignments

WITH topic_updates(video_id, new_topic_1, new_topic_2, new_topic_3) AS (
  VALUES 
  ${values}
)
UPDATE videos 
SET 
  topic_level_1 = topic_updates.new_topic_1,
  topic_level_2 = topic_updates.new_topic_2,
  topic_level_3 = topic_updates.new_topic_3,
  updated_at = NOW()
FROM topic_updates
WHERE videos.id = topic_updates.video_id;

-- Verify this chunk
SELECT COUNT(*) as updated_count 
FROM videos 
WHERE topic_level_1 IS NOT NULL 
AND updated_at > NOW() - INTERVAL '1 minute';`;

      const filename = `chunk_${chunkNum.toString().padStart(2, '0')}_of_${totalChunks}.sql`;
      const filepath = path.join(this.outputDir, filename);
      
      fs.writeFileSync(filepath, sql);
      console.log(`   ✅ Generated ${filename} (${chunk.length} assignments, ~${Math.round(sql.length/1024)}KB)`);
    }
    
    // Generate a summary file
    const summary = `-- Topic Assignment Summary
-- Generated: ${new Date().toISOString()}
-- Total assignments: ${assignments.length}
-- Total chunks: ${totalChunks}
-- Chunk size: ${this.chunkSize}

-- Run these files in order:
${Array.from({length: totalChunks}, (_, i) => 
  `-- ${i + 1}. chunk_${(i + 1).toString().padStart(2, '0')}_of_${totalChunks}.sql`
).join('\n')}

-- Final verification:
SELECT 
  COUNT(*) as total_videos,
  COUNT(CASE WHEN topic_level_1 IS NOT NULL THEN 1 END) as assigned_videos,
  COUNT(CASE WHEN topic_level_1 IS NULL THEN 1 END) as remaining_unassigned
FROM videos;`;

    fs.writeFileSync(path.join(this.outputDir, '00_SUMMARY.sql'), summary);
    console.log(`   📋 Generated 00_SUMMARY.sql with execution instructions`);
  }

  async run() {
    console.log('🚀 Starting SQL Generation for Topic Assignments\n');
    
    try {
      await this.setup();
      const loaded = await this.loadBERTopicResults();
      
      if (!loaded) {
        console.error('❌ Failed to load BERTopic results');
        return;
      }
      
      const hasWork = await this.findMissingAssignments();
      
      if (hasWork) {
        this.generateSQLChunks();
        console.log(`\n🎉 SQL files generated in: ${this.outputDir}`);
        console.log('📋 Run the chunks in order, copy/paste each one into Supabase SQL editor');
      }
      
    } catch (error) {
      console.error('❌ Generation failed:', error.message);
      console.error(error.stack);
    }
  }
}

const generator = new SQLGenerator();
generator.run();