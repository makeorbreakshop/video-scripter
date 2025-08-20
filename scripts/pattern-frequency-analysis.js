#!/usr/bin/env node
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function analyzePatternFrequency() {
  console.log('🔍 Finding patterns supported by 10+ videos...\n');
  
  try {
    // Load the full dataset
    const dataPath = path.join(path.dirname(__dirname), 'exports', 'outliers-may-june-2025-2025-08-16.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const videos = data.videos;
    
    console.log(`📊 Analyzing ${videos.length} total outlier videos\n`);

    // Define specific patterns to search for
    const patterns = {
      // Number patterns
      "Specific Dollar Amounts": {
        regex: /\$[\d,]+/g,
        examples: []
      },
      "Time Promises": {
        regex: /\d+\s*(hour|minute|day|week|month|year)s?/gi,
        examples: []
      },
      "Percentage Claims": {
        regex: /\d+%/g,
        examples: []
      },
      "Age/Experience Claims": {
        regex: /\d+\s*year/gi,
        examples: []
      },

      // Emotional/Action patterns
      "Avoid/Don't Do": {
        regex: /\b(avoid|don't|never|stop)\b/gi,
        examples: []
      },
      "Secret/Hidden": {
        regex: /\b(secret|hidden|nobody|tells|hack)\b/gi,
        examples: []
      },
      "Best/Top/Ultimate": {
        regex: /\b(best|top|ultimate|perfect|greatest)\b/gi,
        examples: []
      },
      "Shocking/Unbelievable": {
        regex: /\b(shocking|unbelievable|amazing|incredible|won't believe)\b/gi,
        examples: []
      },
      "Fast/Quick/Easy": {
        regex: /\b(fast|quick|easy|simple|instant)\b/gi,
        examples: []
      },
      "Wrong/Mistake": {
        regex: /\b(wrong|mistake|error|fail|dangerous)\b/gi,
        examples: []
      },

      // Content structure patterns
      "Number Lists": {
        regex: /\b\d+\s+(things|ways|tips|tricks|mistakes|secrets|ideas|reasons)\b/gi,
        examples: []
      },
      "Question Titles": {
        regex: /\?$/,
        examples: []
      },
      "How To": {
        regex: /^how\s+to\b/gi,
        examples: []
      },
      "This/These": {
        regex: /^(this|these)\b/gi,
        examples: []
      },

      // Specific claim patterns
      "DIY Projects": {
        regex: /\bDIY\b/gi,
        examples: []
      },
      "Before/After": {
        regex: /\b(before|after|transformation|turned|into)\b/gi,
        examples: []
      },
      "Free/No Cost": {
        regex: /\b(free|no\s+cost|zero|nothing)\b/gi,
        examples: []
      },
      "Professional vs Amateur": {
        regex: /\b(professional|pro|expert|master|beginner|amateur)\b/gi,
        examples: []
      }
    };

    // Analyze each pattern
    Object.entries(patterns).forEach(([patternName, patternData]) => {
      videos.forEach(video => {
        const titleLower = video.title.toLowerCase();
        const summaryLower = video.llm_summary?.toLowerCase() || '';
        const combinedText = titleLower + ' ' + summaryLower;
        
        if (patternData.regex.test(video.title) || patternData.regex.test(video.llm_summary || '')) {
          patternData.examples.push({
            title: video.title,
            score: parseFloat(video.performance_score),
            niche: video.topic_niche,
            video_id: video.video_id
          });
        }
      });
      
      // Reset regex for next pattern
      patternData.regex.lastIndex = 0;
    });

    // Filter patterns with 10+ examples and sort by frequency
    const significantPatterns = Object.entries(patterns)
      .filter(([_, data]) => data.examples.length >= 10)
      .sort((a, b) => b[1].examples.length - a[1].examples.length);

    console.log('🎯 Patterns Found in 10+ Videos:');
    console.log('=================================\n');

    significantPatterns.forEach(([patternName, data]) => {
      const avgScore = data.examples.reduce((sum, ex) => sum + ex.score, 0) / data.examples.length;
      const niches = [...new Set(data.examples.map(ex => ex.niche))];
      
      console.log(`📊 ${patternName} (${data.examples.length} videos)`);
      console.log(`   Average Performance: ${avgScore.toFixed(1)}x`);
      console.log(`   Across ${niches.length} niches`);
      console.log(`   Top Examples:`);
      
      // Show top 5 examples sorted by performance
      data.examples
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .forEach(example => {
          console.log(`     ${example.score}x: ${example.title.substring(0, 70)}${example.title.length > 70 ? '...' : ''}`);
        });
      console.log('');
    });

    // Find specific combinations that are particularly powerful
    console.log('🔥 High-Performing Pattern Combinations:');
    console.log('========================================\n');

    // Look for videos that combine multiple patterns
    const combinationVideos = videos.filter(video => {
      let patternCount = 0;
      Object.values(patterns).forEach(pattern => {
        if (pattern.regex.test(video.title) || pattern.regex.test(video.llm_summary || '')) {
          patternCount++;
        }
        pattern.regex.lastIndex = 0;
      });
      return patternCount >= 3 && parseFloat(video.performance_score) >= 20;
    });

    combinationVideos
      .sort((a, b) => parseFloat(b.performance_score) - parseFloat(a.performance_score))
      .slice(0, 10)
      .forEach(video => {
        console.log(`${video.performance_score}x: ${video.title}`);
        console.log(`   Niche: ${video.topic_niche}`);
        
        // Show which patterns this video hits
        const hitPatterns = [];
        Object.entries(patterns).forEach(([name, pattern]) => {
          if (pattern.regex.test(video.title) || pattern.regex.test(video.llm_summary || '')) {
            hitPatterns.push(name);
          }
          pattern.regex.lastIndex = 0;
        });
        console.log(`   Patterns: ${hitPatterns.join(', ')}`);
        console.log('');
      });

    // Save detailed analysis
    const timestamp = new Date().toISOString().split('T')[0];
    const analysisPath = path.join(path.dirname(__dirname), 'exports', `pattern-frequency-analysis-${timestamp}.json`);
    
    const analysisData = {};
    significantPatterns.forEach(([name, data]) => {
      analysisData[name] = {
        count: data.examples.length,
        avg_score: data.examples.reduce((sum, ex) => sum + ex.score, 0) / data.examples.length,
        examples: data.examples.sort((a, b) => b.score - a.score)
      };
    });

    await fs.writeFile(analysisPath, JSON.stringify({
      metadata: {
        total_videos: videos.length,
        patterns_found: significantPatterns.length,
        analysis_date: new Date().toISOString()
      },
      patterns: analysisData,
      high_combination_videos: combinationVideos.slice(0, 20)
    }, null, 2));
    
    console.log(`✅ Detailed analysis saved to: ${path.basename(analysisPath)}`);

  } catch (error) {
    console.error('❌ Error analyzing pattern frequency:', error);
    process.exit(1);
  }
}

// Run the analysis
analyzePatternFrequency();