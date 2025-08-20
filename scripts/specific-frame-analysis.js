#!/usr/bin/env node
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function analyzeSpecificFrames() {
  console.log('🎯 Finding specific psychological frames...\n');
  
  try {
    // Load the full dataset
    const dataPath = path.join(path.dirname(__dirname), 'exports', 'outliers-may-june-2025-2025-08-16.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const videos = data.videos;
    
    console.log(`📊 Analyzing ${videos.length} videos for specific frames\n`);

    // Define specific psychological frames to look for
    const frames = {
      "Waste to Wonder": {
        patterns: [
          /discarded.*into/i,
          /scrap.*into/i,
          /trash.*into/i,
          /old.*into/i,
          /rotten.*into/i,
          /broken.*into/i,
          /waste.*into/i,
          /rusted.*into/i,
          /dried.*into/i,
          /empty.*into/i
        ],
        examples: []
      },
      
      "Tiny Investment, Massive Return": {
        patterns: [
          /\$[\d,]+.*\$[\d,]+/i, // Two dollar amounts
          /small.*big/i,
          /little.*huge/i,
          /\d+\s*acre.*\$[\d,]+/i,
          /\$\d+.*trick/i,
          /under.*\$\d+.*\$[\d,]+/i
        ],
        examples: []
      },
      
      "Professional Secrets Exposed": {
        patterns: [
          /secrets?.*(?:pro|professional|expert|master)/i,
          /(?:pro|professional|expert|master).*secrets?/i,
          /insider.*secrets?/i,
          /what.*(?:pros?|experts?|professionals?).*don't/i,
          /(?:pros?|experts?).*don't.*want/i,
          /hidden.*(?:techniques?|methods?|tricks?)/i
        ],
        examples: []
      },
      
      "Effortless Mastery": {
        patterns: [
          /just.*(?:cutting|doing|making)/i,
          /simply.*(?:cutting|doing|making)/i,
          /(?:master|expert).*makes?.*look.*easy/i,
          /50.*years?.*(?:cutting|making|doing)/i,
          /decades.*(?:experience|mastery)/i,
          /effortless/i
        ],
        examples: []
      },
      
      "Forbidden Knowledge": {
        patterns: [
          /feels?.*illegal/i,
          /shouldn't.*(?:work|exist)/i,
          /too.*(?:good|powerful)/i,
          /government.*(?:doesn't|won't)/i,
          /they.*don't.*want.*you/i,
          /banned.*(?:technique|method)/i,
          /illegal.*(?:hack|trick|method)/i
        ],
        examples: []
      },
      
      "Impossible Made Possible": {
        patterns: [
          /impossible.*(?:possible|real|true)/i,
          /can't.*believe/i,
          /shouldn't.*be.*possible/i,
          /defies.*(?:logic|physics|belief)/i,
          /breaks.*(?:rules|laws)/i,
          /thought.*impossible/i
        ],
        examples: []
      },
      
      "Time Compression Magic": {
        patterns: [
          /(?:before|in).*breakfast/i,
          /(?:in|within).*(?:minutes?|hours?).*(?:days?|weeks?|months?|years?)/i,
          /overnight.*(?:success|transformation)/i,
          /instant.*(?:results?|transformation)/i,
          /\d+.*(?:minutes?|hours?).*(?:complete|full|entire)/i
        ],
        examples: []
      },
      
      "Reverse Engineering Success": {
        patterns: [
          /how.*(?:they|she|he).*built/i,
          /how.*(?:they|she|he).*makes?/i,
          /how.*(?:they|she|he).*earns?/i,
          /behind.*scenes?/i,
          /(?:inside|real).*story/i,
          /breakdown.*of.*how/i
        ],
        examples: []
      },
      
      "David vs Goliath": {
        patterns: [
          /(?:small|tiny|little).*(?:beats?|destroys?|outperforms?)/i,
          /(?:amateur|beginner).*(?:beats?|outperforms?).*(?:pro|professional|expert)/i,
          /underdog.*(?:wins?|beats?)/i,
          /(?:nobody|unknown).*(?:beats?|destroys?)/i,
          /little.*guy.*(?:wins?|beats?)/i
        ],
        examples: []
      },
      
      "Hidden in Plain Sight": {
        patterns: [
          /nobody.*(?:knows?|realizes?|sees?)/i,
          /(?:secret|hidden).*in.*(?:plain|sight)/i,
          /right.*under.*(?:nose|eyes)/i,
          /(?:everyone|most.*people).*(?:misses?|ignores?)/i,
          /overlooked.*(?:secret|method|trick)/i
        ],
        examples: []
      },
      
      "Status Anxiety Trigger": {
        patterns: [
          /look.*cheap/i,
          /makes?.*you.*look.*(?:poor|cheap|amateur)/i,
          /avoid.*(?:looking|appearing)/i,
          /mistakes?.*that.*make.*you.*look/i,
          /don't.*look.*like.*(?:pro|professional|expert)/i,
          /screams?.*(?:cheap|amateur|beginner)/i
        ],
        examples: []
      },
      
      "Constraint Liberation": {
        patterns: [
          /no.*(?:motor|power|electricity)/i,
          /without.*(?:tools?|equipment|help)/i,
          /zero.*(?:budget|cost|money)/i,
          /no.*(?:experience|training).*needed/i,
          /with.*just.*(?:one|two|\$\d+)/i,
          /only.*(?:need|requires?)/i
        ],
        examples: []
      }
    };

    // Analyze each video against each frame
    Object.entries(frames).forEach(([frameName, frameData]) => {
      videos.forEach(video => {
        const combinedText = `${video.title} ${video.llm_summary || ''}`;
        
        // Check if any pattern matches
        const matches = frameData.patterns.some(pattern => pattern.test(combinedText));
        
        if (matches) {
          frameData.examples.push({
            title: video.title,
            score: parseFloat(video.performance_score),
            niche: video.topic_niche,
            video_id: video.video_id,
            summary: video.llm_summary?.substring(0, 150) + '...'
          });
        }
      });
    });

    // Filter frames with at least 8 examples and sort by average performance
    const significantFrames = Object.entries(frames)
      .filter(([_, data]) => data.examples.length >= 8)
      .map(([name, data]) => ({
        name,
        count: data.examples.length,
        avgScore: data.examples.reduce((sum, ex) => sum + ex.score, 0) / data.examples.length,
        examples: data.examples.sort((a, b) => b.score - a.score),
        niches: [...new Set(data.examples.map(ex => ex.niche))].length
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    console.log('🎯 Specific Psychological Frames (8+ examples):');
    console.log('===============================================\n');

    significantFrames.forEach(frame => {
      console.log(`🔥 ${frame.name} (${frame.count} videos, ${frame.avgScore.toFixed(1)}x avg)`);
      console.log(`   Across ${frame.niches} different niches`);
      console.log(`   Top Examples:`);
      
      // Show top 10 examples
      frame.examples.slice(0, 10).forEach((example, i) => {
        console.log(`     ${i+1}. ${example.score}x: "${example.title}" (${example.niche})`);
      });
      console.log('');
    });

    // Find cross-frame combinations
    console.log('🔥 Videos Using Multiple Frames:');
    console.log('=================================\n');

    const multiFrameVideos = videos.filter(video => {
      const combinedText = `${video.title} ${video.llm_summary || ''}`;
      let frameCount = 0;
      
      Object.values(frames).forEach(frameData => {
        const matches = frameData.patterns.some(pattern => pattern.test(combinedText));
        if (matches) frameCount++;
      });
      
      return frameCount >= 2 && parseFloat(video.performance_score) >= 15;
    });

    multiFrameVideos
      .sort((a, b) => parseFloat(b.performance_score) - parseFloat(a.performance_score))
      .slice(0, 10)
      .forEach(video => {
        const combinedText = `${video.title} ${video.llm_summary || ''}`;
        const hitFrames = [];
        
        Object.entries(frames).forEach(([frameName, frameData]) => {
          const matches = frameData.patterns.some(pattern => pattern.test(combinedText));
          if (matches) hitFrames.push(frameName);
        });
        
        console.log(`${video.performance_score}x: "${video.title}"`);
        console.log(`   Niche: ${video.topic_niche}`);
        console.log(`   Frames: ${hitFrames.join(', ')}`);
        console.log('');
      });

    // Save analysis
    const timestamp = new Date().toISOString().split('T')[0];
    const analysisPath = path.join(path.dirname(__dirname), 'exports', `specific-frame-analysis-${timestamp}.json`);
    
    await fs.writeFile(analysisPath, JSON.stringify({
      metadata: {
        total_videos: videos.length,
        frames_found: significantFrames.length,
        analysis_date: new Date().toISOString()
      },
      frames: significantFrames,
      multi_frame_videos: multiFrameVideos.slice(0, 20)
    }, null, 2));
    
    console.log(`✅ Specific frame analysis saved to: ${path.basename(analysisPath)}`);

  } catch (error) {
    console.error('❌ Error analyzing specific frames:', error);
    process.exit(1);
  }
}

// Run the analysis
analyzeSpecificFrames();