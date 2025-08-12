/**
 * Production-Ready Thumbnail Analysis
 * Uses GPT-4o-mini until GPT-5 is fixed, with automatic fallback
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Model configurations with fallback
const MODELS = {
  primary: {
    name: 'gpt-5-nano',
    paramName: 'max_completion_tokens',
    costPer1M: { input: 0.05, output: 0.40 },
    enabled: false // Set to true when GPT-5 starts working
  },
  fallback: {
    name: 'gpt-4o-mini',
    paramName: 'max_tokens',
    costPer1M: { input: 0.15, output: 0.60 },
    enabled: true
  }
};

/**
 * Analyze a single thumbnail with automatic model fallback
 */
async function analyzeThumbnail(video, options = {}) {
  const {
    verbose = false,
    maxTokens = 200,
    detail = 'high'
  } = options;
  
  // Choose model based on availability
  const model = MODELS.primary.enabled ? MODELS.primary : MODELS.fallback;
  
  if (verbose) {
    console.log(`🔍 Analyzing with ${model.name}...`);
  }
  
  const prompt = `This video achieved ${video.temporal_performance_score.toFixed(1)}x the channel's baseline performance.

Title: "${video.title}"
Channel: ${video.channel_name}

Analyze this thumbnail and provide:

1. VISUAL HOOK: The specific element that grabs attention (one line)
2. INFORMATION GAP: What question does title+thumbnail create? (one line)
3. PATTERN FORMULA: [Title does X] + [Thumbnail shows Y] = [Viewer feels Z] (one line)
4. REPLICABILITY: How easily can this pattern be applied to other videos? (1-10 score)
5. KEY INSIGHT: The actionable takeaway for creators (one line)`;
  
  try {
    const startTime = Date.now();
    
    // Build request with model-specific parameter
    const request = {
      model: model.name,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { 
            type: 'image_url', 
            image_url: { 
              url: video.thumbnail_url,
              detail: detail
            }
          }
        ]
      }]
    };
    
    // Use correct parameter name for the model
    request[model.paramName] = maxTokens;
    
    const response = await openai.chat.completions.create(request);
    const processingTime = Date.now() - startTime;
    
    const content = response.choices[0].message.content;
    const usage = response.usage;
    
    // Check if we got content (for GPT-5 readiness check)
    if (!content && model.name.includes('gpt-5')) {
      if (verbose) {
        console.log('⚠️ GPT-5 returned empty content, falling back to GPT-4o-mini');
      }
      
      // Retry with fallback
      request.model = MODELS.fallback.name;
      delete request[model.paramName];
      request[MODELS.fallback.paramName] = maxTokens;
      
      const fallbackResponse = await openai.chat.completions.create(request);
      return processResponse(fallbackResponse, MODELS.fallback, processingTime, video);
    }
    
    return processResponse(response, model, processingTime, video);
    
  } catch (error) {
    console.error(`Error analyzing thumbnail: ${error.message}`);
    return null;
  }
}

/**
 * Process API response into structured data
 */
function processResponse(response, model, processingTime, video) {
  const content = response.choices[0].message.content;
  const usage = response.usage;
  
  // Calculate cost
  const cost = (usage.prompt_tokens * model.costPer1M.input / 1000000) + 
               (usage.completion_tokens * model.costPer1M.output / 1000000);
  
  // Parse the structured response
  const analysis = parseAnalysis(content);
  
  return {
    videoId: video.id,
    videoTitle: video.title,
    channel: video.channel_name,
    performance: video.temporal_performance_score,
    thumbnailUrl: video.thumbnail_url,
    analysis,
    metadata: {
      model: model.name,
      processingTime,
      cost,
      tokens: {
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens
      },
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Parse structured analysis from text response
 */
function parseAnalysis(content) {
  const lines = content.split('\n');
  const analysis = {
    visualHook: '',
    informationGap: '',
    patternFormula: '',
    replicability: 0,
    keyInsight: ''
  };
  
  lines.forEach(line => {
    if (line.includes('VISUAL HOOK:')) {
      analysis.visualHook = line.split('VISUAL HOOK:')[1].trim();
    } else if (line.includes('INFORMATION GAP:')) {
      analysis.informationGap = line.split('INFORMATION GAP:')[1].trim();
    } else if (line.includes('PATTERN FORMULA:')) {
      analysis.patternFormula = line.split('PATTERN FORMULA:')[1].trim();
    } else if (line.includes('REPLICABILITY:')) {
      const match = line.match(/(\d+)/);
      analysis.replicability = match ? parseInt(match[1]) : 0;
    } else if (line.includes('KEY INSIGHT:')) {
      analysis.keyInsight = line.split('KEY INSIGHT:')[1].trim();
    }
  });
  
  return analysis;
}

/**
 * Batch analyze multiple videos
 */
async function batchAnalyze(videos, options = {}) {
  const {
    concurrency = 3,
    saveResults = true,
    verbose = true
  } = options;
  
  console.log(`\n🚀 Batch Analyzing ${videos.length} Thumbnails`);
  console.log('=' .repeat(50));
  
  const results = [];
  const errors = [];
  
  // Process in batches for rate limiting
  for (let i = 0; i < videos.length; i += concurrency) {
    const batch = videos.slice(i, i + concurrency);
    
    if (verbose) {
      console.log(`\nProcessing batch ${Math.floor(i/concurrency) + 1}/${Math.ceil(videos.length/concurrency)}`);
    }
    
    const batchPromises = batch.map(async (video) => {
      try {
        const result = await analyzeThumbnail(video, { verbose: false });
        if (result) {
          results.push(result);
          if (verbose) {
            console.log(`✅ ${video.title.substring(0, 50)}...`);
          }
        }
        return result;
      } catch (error) {
        errors.push({ video: video.id, error: error.message });
        if (verbose) {
          console.log(`❌ ${video.title.substring(0, 50)}... - ${error.message}`);
        }
        return null;
      }
    });
    
    await Promise.all(batchPromises);
    
    // Rate limiting between batches
    if (i + concurrency < videos.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Calculate summary statistics
  const totalCost = results.reduce((sum, r) => sum + r.metadata.cost, 0);
  const avgProcessingTime = results.reduce((sum, r) => sum + r.metadata.processingTime, 0) / results.length;
  
  const summary = {
    totalVideos: videos.length,
    successfulAnalyses: results.length,
    errors: errors.length,
    totalCost,
    avgProcessingTime,
    modelUsed: MODELS.primary.enabled ? 'gpt-5-nano' : 'gpt-4o-mini',
    timestamp: new Date().toISOString()
  };
  
  console.log('\n📊 Batch Analysis Complete');
  console.log(`- Analyzed: ${results.length}/${videos.length}`);
  console.log(`- Total cost: $${totalCost.toFixed(4)}`);
  console.log(`- Avg time: ${avgProcessingTime.toFixed(0)}ms`);
  console.log(`- Model: ${summary.modelUsed}`);
  
  if (saveResults) {
    const filename = `data/thumbnail_analysis_${new Date().toISOString().split('T')[0]}.json`;
    await fs.writeFile(filename, JSON.stringify({
      summary,
      results,
      errors
    }, null, 2));
    console.log(`💾 Results saved to: ${filename}`);
  }
  
  return { summary, results, errors };
}

/**
 * Test if GPT-5 is working yet
 */
async function testGPT5Availability() {
  console.log('\n🧪 Testing GPT-5 Availability...');
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: 'Say "working"' }],
      max_completion_tokens: 10
    });
    
    if (response.choices[0].message.content) {
      console.log('✅ GPT-5 is now returning content!');
      MODELS.primary.enabled = true;
      return true;
    } else {
      console.log('⚠️ GPT-5 still returning empty content');
      return false;
    }
  } catch (error) {
    console.log(`❌ GPT-5 test failed: ${error.message}`);
    return false;
  }
}

/**
 * Find patterns across high-performing videos
 */
async function findPatterns(minPerformance = 10, limit = 20) {
  console.log('\n🔍 Finding Patterns in High-Performing Videos');
  console.log('=' .repeat(50));
  
  // Get high-performing videos
  const { data: videos, error } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', minPerformance)
    .not('thumbnail_url', 'is', null)
    .order('temporal_performance_score', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  console.log(`Found ${videos.length} videos with >${minPerformance}x performance`);
  
  // Analyze all videos
  const { results } = await batchAnalyze(videos, {
    concurrency: 3,
    saveResults: true,
    verbose: true
  });
  
  // Extract patterns
  const patterns = {
    visualHooks: {},
    informationGaps: {},
    formulas: {},
    insights: []
  };
  
  results.forEach(r => {
    // Count visual hooks
    const hookWords = r.analysis.visualHook.toLowerCase().split(/\s+/);
    hookWords.forEach(word => {
      if (word.length > 3) {
        patterns.visualHooks[word] = (patterns.visualHooks[word] || 0) + 1;
      }
    });
    
    // Collect unique formulas
    if (r.analysis.patternFormula) {
      patterns.formulas[r.analysis.patternFormula] = 
        (patterns.formulas[r.analysis.patternFormula] || 0) + 1;
    }
    
    // High replicability insights
    if (r.analysis.replicability >= 7) {
      patterns.insights.push({
        insight: r.analysis.keyInsight,
        replicability: r.analysis.replicability,
        performance: r.performance
      });
    }
  });
  
  // Sort and display top patterns
  console.log('\n📊 TOP PATTERNS DISCOVERED:');
  
  console.log('\n🎯 Most Common Visual Hooks:');
  Object.entries(patterns.visualHooks)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([word, count]) => {
      console.log(`  - "${word}": ${count} occurrences`);
    });
  
  console.log('\n🔗 Most Replicable Insights:');
  patterns.insights
    .sort((a, b) => b.replicability - a.replicability)
    .slice(0, 5)
    .forEach(insight => {
      console.log(`  - [${insight.replicability}/10] ${insight.insight}`);
    });
  
  return patterns;
}

// Example usage
async function main() {
  console.log('🎬 THUMBNAIL ANALYSIS PRODUCTION SYSTEM');
  console.log('=' .repeat(60));
  
  // Test GPT-5 availability
  const gpt5Works = await testGPT5Availability();
  
  if (!gpt5Works) {
    console.log('📌 Using GPT-4o-mini as fallback ($0.15/$0.60 per 1M tokens)');
  } else {
    console.log('🎉 Using GPT-5-nano ($0.05/$0.40 per 1M tokens)');
  }
  
  // Example: Analyze a single video
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 20)
    .not('thumbnail_url', 'is', null)
    .limit(1)
    .single();
  
  if (video) {
    console.log(`\n📹 Analyzing: "${video.title}"`);
    const result = await analyzeThumbnail(video, { verbose: true });
    
    if (result) {
      console.log('\n📋 Analysis Results:');
      console.log(`Visual Hook: ${result.analysis.visualHook}`);
      console.log(`Information Gap: ${result.analysis.informationGap}`);
      console.log(`Pattern Formula: ${result.analysis.patternFormula}`);
      console.log(`Replicability: ${result.analysis.replicability}/10`);
      console.log(`Key Insight: ${result.analysis.keyInsight}`);
      console.log(`\nCost: $${result.metadata.cost.toFixed(5)}`);
    }
  }
  
  // Example: Find patterns across high performers
  await findPatterns(15, 10);
}

// Export for use in other scripts
export {
  analyzeThumbnail,
  batchAnalyze,
  testGPT5Availability,
  findPatterns
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}