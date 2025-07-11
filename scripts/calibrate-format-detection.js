#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Import format detection service
const { FormatDetectionService, VideoFormat } = require('../lib/format-detection-service');
const formatService = new FormatDetectionService();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

class FormatCalibrationTool {
  constructor() {
    this.results = [];
    this.lowConfidenceCases = [];
    this.manualLabels = [];
    this.thresholdAnalysis = {
      0.5: { correct: 0, total: 0 },
      0.6: { correct: 0, total: 0 },
      0.7: { correct: 0, total: 0 },
      0.8: { correct: 0, total: 0 }
    };
  }

  async run() {
    console.log('Format Detection Calibration Tool');
    console.log('=================================\n');

    // Load sample videos
    const videos = await this.loadSampleVideos();
    console.log(`Loaded ${videos.length} videos for calibration.\n`);

    // Process videos and identify low confidence cases
    await this.processVideos(videos);

    // Interactive labeling for low confidence cases
    if (this.lowConfidenceCases.length > 0) {
      console.log(`\nFound ${this.lowConfidenceCases.length} low confidence cases.`);
      await this.interactiveLabeling();
    }

    // Analyze results
    await this.analyzeResults();

    // Save results
    await this.saveResults();

    rl.close();
  }

  async loadSampleVideos() {
    try {
      // Try to load from file first
      const calibrationFile = path.join(__dirname, '..', 'data', 'calibration-videos.json');
      const data = await fs.readFile(calibrationFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Fall back to database
      console.log('Loading sample videos from database...');
      const { data, error: dbError } = await supabase
        .from('videos')
        .select('id, title, channel_title, description')
        .order('view_count', { ascending: false })
        .limit(500);

      if (dbError) throw dbError;
      return data || [];
    }
  }

  async processVideos(videos) {
    console.log('Processing videos...');
    const progressInterval = Math.ceil(videos.length / 20);

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const result = formatService.detectFormat(
        video.title,
        video.channel_title,
        video.description
      );

      this.results.push({
        video,
        detection: result
      });

      if (result.confidence < 0.7 || result.requiresLLM) {
        this.lowConfidenceCases.push({
          video,
          detection: result
        });
      }

      if ((i + 1) % progressInterval === 0) {
        process.stdout.write('.');
      }
    }
    console.log(' Done!\n');
  }

  async interactiveLabeling() {
    console.log('\nStarting interactive labeling session...');
    console.log('For each video, select the correct format or skip.\n');

    const formats = Object.values(VideoFormat);
    const formatDisplay = formats.map((f, i) => `${i + 1}. ${f}`).join('\n');

    for (let i = 0; i < Math.min(this.lowConfidenceCases.length, 50); i++) {
      const { video, detection } = this.lowConfidenceCases[i];
      
      console.log(`\n--- Video ${i + 1}/${Math.min(this.lowConfidenceCases.length, 50)} ---`);
      console.log(`Title: ${video.title}`);
      console.log(`Channel: ${video.channel_title || 'Unknown'}`);
      if (video.description) {
        console.log(`Description: ${video.description.substring(0, 150)}...`);
      }
      
      console.log(`\nDetected: ${detection.format} (confidence: ${detection.confidence})`);
      console.log('Top matches:');
      detection.scores.slice(0, 3).forEach(score => {
        console.log(`  - ${score.format}: ${score.score} (${score.matchedKeywords.strong.join(', ')})`);
      });
      
      console.log(`\nFormats:\n${formatDisplay}`);
      console.log('0. Skip this video');
      
      const answer = await question('\nSelect correct format (0-7): ');
      const selection = parseInt(answer);
      
      if (selection > 0 && selection <= formats.length) {
        const correctFormat = formats[selection - 1];
        this.manualLabels.push({
          video,
          detection,
          correctFormat,
          isCorrect: correctFormat === detection.format
        });
        
        // Update threshold analysis
        for (const threshold of Object.keys(this.thresholdAnalysis)) {
          const t = parseFloat(threshold);
          if (detection.confidence >= t) {
            this.thresholdAnalysis[threshold].total++;
            if (correctFormat === detection.format) {
              this.thresholdAnalysis[threshold].correct++;
            }
          }
        }
      }
    }
  }

  async analyzeResults() {
    console.log('\n\nAnalysis Results');
    console.log('================\n');

    // Overall statistics
    const totalVideos = this.results.length;
    const lowConfidence = this.lowConfidenceCases.length;
    const highConfidence = totalVideos - lowConfidence;
    
    console.log(`Total videos processed: ${totalVideos}`);
    console.log(`High confidence (>0.7): ${highConfidence} (${(highConfidence/totalVideos*100).toFixed(1)}%)`);
    console.log(`Low confidence (<0.7): ${lowConfidence} (${(lowConfidence/totalVideos*100).toFixed(1)}%)`);

    // Manual labeling accuracy
    if (this.manualLabels.length > 0) {
      const correct = this.manualLabels.filter(l => l.isCorrect).length;
      const accuracy = correct / this.manualLabels.length;
      
      console.log(`\nManual Labeling Results:`);
      console.log(`Labeled: ${this.manualLabels.length} videos`);
      console.log(`Correct: ${correct} (${(accuracy * 100).toFixed(1)}%)`);

      // Threshold analysis
      console.log('\nThreshold Analysis:');
      for (const [threshold, stats] of Object.entries(this.thresholdAnalysis)) {
        if (stats.total > 0) {
          const accuracy = stats.correct / stats.total;
          console.log(`  ${threshold}: ${(accuracy * 100).toFixed(1)}% accuracy (${stats.total} samples)`);
        }
      }
    }

    // Format distribution
    console.log('\nFormat Distribution:');
    const formatCounts = {};
    this.results.forEach(r => {
      formatCounts[r.detection.format] = (formatCounts[r.detection.format] || 0) + 1;
    });
    
    Object.entries(formatCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([format, count]) => {
        console.log(`  ${format}: ${count} (${(count/totalVideos*100).toFixed(1)}%)`);
      });

    // Common edge cases
    console.log('\nCommon Edge Cases:');
    const edgeCases = this.analyzeEdgeCases();
    edgeCases.slice(0, 10).forEach(({ pattern, count, examples }) => {
      console.log(`  ${pattern}: ${count} occurrences`);
      examples.slice(0, 2).forEach(ex => {
        console.log(`    - "${ex}"`);
      });
    });
  }

  analyzeEdgeCases() {
    const patterns = new Map();

    this.lowConfidenceCases.forEach(({ video, detection }) => {
      // Identify patterns in low confidence cases
      const title = video.title.toLowerCase();
      
      // Check for multiple format signals
      if (detection.scores[0].score > 0 && detection.scores[1].score / detection.scores[0].score > 0.8) {
        const pattern = `Mixed signals: ${detection.scores[0].format} vs ${detection.scores[1].format}`;
        if (!patterns.has(pattern)) {
          patterns.set(pattern, { count: 0, examples: [] });
        }
        const data = patterns.get(pattern);
        data.count++;
        if (data.examples.length < 5) {
          data.examples.push(video.title);
        }
      }

      // Check for very short titles
      if (title.split(/\s+/).length < 3) {
        const pattern = 'Very short title';
        if (!patterns.has(pattern)) {
          patterns.set(pattern, { count: 0, examples: [] });
        }
        const data = patterns.get(pattern);
        data.count++;
        if (data.examples.length < 5) {
          data.examples.push(video.title);
        }
      }

      // Check for no keyword matches
      const totalMatches = detection.scores.reduce((sum, s) => 
        sum + s.matchedKeywords.strong.length + 
        s.matchedKeywords.medium.length + 
        s.matchedKeywords.weak.length, 0
      );
      if (totalMatches === 0) {
        const pattern = 'No keyword matches';
        if (!patterns.has(pattern)) {
          patterns.set(pattern, { count: 0, examples: [] });
        }
        const data = patterns.get(pattern);
        data.count++;
        if (data.examples.length < 5) {
          data.examples.push(video.title);
        }
      }
    });

    return Array.from(patterns.entries())
      .map(([pattern, data]) => ({ pattern, ...data }))
      .sort((a, b) => b.count - a.count);
  }

  async saveResults() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(__dirname, '..', 'data', 'calibration');
    
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Save detailed results
    const resultsFile = path.join(outputDir, `calibration-results-${timestamp}.json`);
    await fs.writeFile(resultsFile, JSON.stringify({
      summary: {
        totalVideos: this.results.length,
        lowConfidenceCases: this.lowConfidenceCases.length,
        manualLabels: this.manualLabels.length,
        thresholdAnalysis: this.thresholdAnalysis
      },
      manualLabels: this.manualLabels,
      edgeCases: this.analyzeEdgeCases(),
      timestamp: new Date().toISOString()
    }, null, 2));

    console.log(`\nResults saved to: ${resultsFile}`);

    // Save recommended configuration
    const recommendedThreshold = this.recommendThreshold();
    const configFile = path.join(outputDir, 'recommended-config.json');
    await fs.writeFile(configFile, JSON.stringify({
      confidenceThreshold: recommendedThreshold,
      ambiguityThreshold: 0.15,
      notes: 'Based on calibration results',
      timestamp: new Date().toISOString()
    }, null, 2));

    console.log(`Recommended configuration saved to: ${configFile}`);
  }

  recommendThreshold() {
    // Find threshold with best balance of accuracy and coverage
    let bestThreshold = 0.6;
    let bestScore = 0;

    for (const [threshold, stats] of Object.entries(this.thresholdAnalysis)) {
      if (stats.total > 0) {
        const accuracy = stats.correct / stats.total;
        const coverage = stats.total / this.manualLabels.length;
        const score = accuracy * 0.7 + coverage * 0.3; // Weight accuracy more
        
        if (score > bestScore) {
          bestScore = score;
          bestThreshold = parseFloat(threshold);
        }
      }
    }

    return bestThreshold;
  }
}

// Run the calibration tool
const tool = new FormatCalibrationTool();
tool.run().catch(console.error);