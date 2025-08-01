#!/usr/bin/env node

/**
 * Daily Topic Classifier Worker
 * 
 * Runs incremental classification on new videos
 * Much more efficient than full BERTopic retraining
 */

const { createClient } = require('@supabase/supabase-js');
const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const index = pinecone.index(process.env.PINECONE_INDEX_NAME || 'youtube-titles-prod');

class DailyTopicClassifier {
  constructor() {
    this.topicCentroids = null;
    this.stats = {
      processed: 0,
      classified: 0,
      outliers: 0,
      skipped: 0,
      errors: 0
    };
  }

  async loadTopicCentroids() {
    console.log('Loading topic centroids from database...');
    
    // Get the most recent topic model metadata
    const { data: modelInfo } = await supabase
      .from('topic_model_metadata')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
      
    if (!modelInfo) {
      console.log('No topic model found. Loading from file...');
      // Try to load from file
      const centroidsPath = path.join(process.cwd(), 'topic_centroids_latest.json');
      try {
        const data = await fs.readFile(centroidsPath, 'utf8');
        this.topicCentroids = JSON.parse(data);
        console.log(`Loaded ${Object.keys(this.topicCentroids).length} topic centroids from file`);
      } catch (error) {
        throw new Error('No topic centroids found. Run full BERTopic first!');
      }
      return;
    }
    
    // Load centroids from database
    const { data: centroids } = await supabase
      .from('topic_centroids')
      .select('*')
      .eq('model_version', modelInfo.version);
      
    this.topicCentroids = {};
    for (const centroid of centroids) {
      this.topicCentroids[centroid.topic_id] = centroid.embedding;
    }
    
    console.log(`Loaded ${Object.keys(this.topicCentroids).length} topic centroids`);
  }

  async getUnclassifiedVideos(hoursBack = 24) {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursBack);
    
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, metadata')
      .is('topic_cluster_id', null)
      .gte('created_at', cutoffTime.toISOString())
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    console.log(`Found ${videos.length} unclassified videos from last ${hoursBack} hours`);
    return videos;
  }

  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  async classifyBatch(videos) {
    const videoIds = videos.map(v => v.id);
    const classifications = [];
    
    // Fetch embeddings from Pinecone
    const [titleVectors, summaryVectors] = await Promise.all([
      index.namespace('').fetch(videoIds),
      index.namespace('llm-summaries').fetch(videoIds)
    ]);
    
    for (const video of videos) {
      const titleVec = titleVectors.vectors[video.id];
      const summaryVec = summaryVectors.vectors[video.id];
      
      if (!titleVec || !summaryVec) {
        console.log(`Missing embeddings for video ${video.id}`);
        this.stats.skipped++;
        continue;
      }
      
      // Combine embeddings (30% title, 70% summary)
      const combined = [];
      for (let i = 0; i < titleVec.values.length; i++) {
        combined[i] = 0.3 * titleVec.values[i] + 0.7 * summaryVec.values[i];
      }
      
      // Find best matching topic
      let bestTopic = -1;
      let bestSimilarity = 0;
      
      for (const [topicId, centroid] of Object.entries(this.topicCentroids)) {
        const similarity = this.cosineSimilarity(combined, centroid);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestTopic = parseInt(topicId);
        }
      }
      
      // Classify based on confidence threshold
      if (bestSimilarity > 0.7) {
        classifications.push({
          id: video.id,
          topic_cluster_id: bestTopic,
          topic_confidence: bestSimilarity,
          classification_method: 'incremental'
        });
        this.stats.classified++;
      } else {
        // Low confidence - mark as outlier
        classifications.push({
          id: video.id,
          topic_cluster_id: -1,
          topic_confidence: bestSimilarity,
          classification_method: 'incremental_outlier'
        });
        this.stats.outliers++;
      }
    }
    
    return classifications;
  }

  async updateDatabase(classifications) {
    // Update in batches of 100
    const batchSize = 100;
    
    for (let i = 0; i < classifications.length; i += batchSize) {
      const batch = classifications.slice(i, i + batchSize);
      
      // Update each video
      const updates = batch.map(c => 
        supabase
          .from('videos')
          .update({
            topic_cluster_id: c.topic_cluster_id,
            topic_confidence: c.topic_confidence,
            classification_timestamp: new Date().toISOString()
          })
          .eq('id', c.id)
      );
      
      await Promise.all(updates);
      console.log(`Updated ${Math.min(i + batchSize, classifications.length)}/${classifications.length} videos`);
    }
  }

  async checkRetrainingNeeded() {
    // Get stats from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: recentVideos } = await supabase
      .from('videos')
      .select('topic_cluster_id, topic_confidence')
      .gte('classification_timestamp', sevenDaysAgo.toISOString());
      
    if (!recentVideos || recentVideos.length === 0) return false;
    
    // Calculate metrics
    const outliers = recentVideos.filter(v => v.topic_cluster_id === -1).length;
    const lowConfidence = recentVideos.filter(v => v.topic_confidence < 0.7).length;
    
    const outlierRate = outliers / recentVideos.length;
    const lowConfRate = lowConfidence / recentVideos.length;
    
    console.log('\nRetraining Check:');
    console.log(`  Recent videos: ${recentVideos.length}`);
    console.log(`  Outlier rate: ${(outlierRate * 100).toFixed(1)}%`);
    console.log(`  Low confidence rate: ${(lowConfRate * 100).toFixed(1)}%`);
    
    if (outlierRate > 0.2 || lowConfRate > 0.3) {
      console.log('⚠️  RETRAINING RECOMMENDED!');
      
      // Create a job entry for monitoring
      await supabase
        .from('jobs')
        .insert({
          type: 'retraining_needed',
          status: 'pending',
          metadata: {
            outlier_rate: outlierRate,
            low_conf_rate: lowConfRate,
            recent_videos: recentVideos.length
          }
        });
        
      return true;
    }
    
    return false;
  }

  async run() {
    console.log('='.repeat(60));
    console.log('Daily Topic Classifier');
    console.log('='.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}\n`);
    
    try {
      // Load topic centroids
      await this.loadTopicCentroids();
      
      // Get unclassified videos
      const videos = await this.getUnclassifiedVideos(24);
      
      if (videos.length === 0) {
        console.log('No new videos to classify');
        return;
      }
      
      // Process in batches
      const batchSize = 50;
      const allClassifications = [];
      
      for (let i = 0; i < videos.length; i += batchSize) {
        const batch = videos.slice(i, i + batchSize);
        console.log(`\nProcessing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(videos.length/batchSize)}`);
        
        const classifications = await this.classifyBatch(batch);
        allClassifications.push(...classifications);
        
        this.stats.processed += batch.length;
      }
      
      // Update database
      if (allClassifications.length > 0) {
        console.log(`\nUpdating ${allClassifications.length} classifications...`);
        await this.updateDatabase(allClassifications);
      }
      
      // Check if retraining needed
      await this.checkRetrainingNeeded();
      
      // Save results
      const results = {
        timestamp: new Date().toISOString(),
        stats: this.stats,
        classifications: allClassifications
      };
      
      const resultsPath = path.join(
        process.cwd(), 
        `incremental_results_${new Date().toISOString().split('T')[0]}.json`
      );
      await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
      
      // Print summary
      console.log('\n' + '='.repeat(60));
      console.log('Summary:');
      console.log(`  Videos processed: ${this.stats.processed}`);
      console.log(`  Classified: ${this.stats.classified}`);
      console.log(`  Outliers: ${this.stats.outliers}`);
      console.log(`  Skipped: ${this.stats.skipped}`);
      console.log(`  Errors: ${this.stats.errors}`);
      console.log('='.repeat(60));
      
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const classifier = new DailyTopicClassifier();
  classifier.run();
}

module.exports = DailyTopicClassifier;