#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize Claude API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Format definitions
const VIDEO_FORMATS = {
  'vlog': 'Casual, diary-style video with personal updates or day-in-the-life content',
  'tutorial': 'Step-by-step instructional content teaching specific skills or procedures',
  'listicle': 'Numbered list format (e.g., "Top 10...", "5 Ways to...")',
  'review': 'Product analysis, testing, or comparison videos',
  'explainer': 'Educational content breaking down complex topics or concepts',
  'news': 'Current events, updates, or breaking news coverage',
  'reaction': 'Commentary or responses to other content, events, or media',
  'interview': 'Q&A or conversation format with guests or experts',
  'challenge': 'Competition, dare, or task-based content',
  'story': 'Narrative-driven content with plot or personal anecdotes',
  'compilation': 'Collections of clips, moments, or highlights',
  'experiment': 'Scientific or social experiments with hypotheses and results',
  'case_study': 'Deep dive analysis of specific examples or scenarios',
  'documentary': 'Long-form investigative or educational content',
  'other': 'Content that doesn\'t fit other categories'
};

// Load test dataset
function loadTestData() {
  const filePath = path.join(__dirname, '..', 'exports', 'format-detection-sample-100-videos-2025-07-11.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Loaded ${data.length} videos from test dataset`);
  return data;
}

// Method 1: Keyword-based scoring
function detectFormatByKeywords(title) {
  const titleLower = title.toLowerCase();
  const scores = {};
  
  const keywords = {
    'tutorial': ['how to', 'tutorial', 'guide', 'learn', 'step by step', 'beginner', 'master'],
    'listicle': [/\d+\s+(ways|things|tips|tricks|reasons|facts|mistakes|secrets|rules|lessons)/i, 'top', 'best', 'worst'],
    'review': ['review', 'unboxing', 'tested', 'testing', 'comparison', 'vs', 'better', 'worth it'],
    'explainer': ['explained', 'what is', 'why', 'how does', 'understanding', 'science of', 'truth about'],
    'news': ['breaking', 'update', 'news', 'announced', 'leaked', 'confirms', 'reports'],
    'reaction': ['reacts to', 'reaction', 'responding to', 'thoughts on', 'my take on'],
    'interview': ['interview', 'q&a', 'asks', 'answers', 'conversation with', 'talks about'],
    'challenge': ['challenge', 'dare', '24 hours', 'survive', 'last to', 'trying', 'attempt'],
    'vlog': ['vlog', 'day in', 'my life', 'daily', 'morning routine', 'night routine'],
    'story': ['story time', 'what happened', 'my experience', 'the time i'],
    'compilation': ['compilation', 'best moments', 'highlights', 'collection', 'montage'],
    'experiment': ['experiment', 'what happens if', 'testing', 'science', 'myth'],
    'case_study': ['case study', 'deep dive', 'analysis', 'breakdown', 'examining'],
    'documentary': ['documentary', 'the story of', 'history of', 'rise and fall', 'inside look']
  };
  
  // Calculate scores for each format
  Object.entries(keywords).forEach(([format, terms]) => {
    scores[format] = 0;
    terms.forEach(term => {
      if (term instanceof RegExp) {
        if (term.test(title)) scores[format] += 2;
      } else if (titleLower.includes(term)) {
        scores[format] += 1;
      }
    });
  });
  
  // Find the format with the highest score
  let maxScore = 0;
  let detectedFormat = 'other';
  let confidence = 'low';
  
  Object.entries(scores).forEach(([format, score]) => {
    if (score > maxScore) {
      maxScore = score;
      detectedFormat = format;
    }
  });
  
  // Determine confidence based on score
  if (maxScore >= 3) confidence = 'high';
  else if (maxScore >= 2) confidence = 'medium';
  else if (maxScore >= 1) confidence = 'low';
  
  return { format: detectedFormat, confidence, score: maxScore };
}

// Method 2: Regex pattern matching
function detectFormatByRegex(title) {
  const patterns = {
    'listicle': /^\d+\s+\w+|top\s+\d+|best\s+\d+|\d+\s+(ways|things|tips|tricks|reasons|facts)/i,
    'tutorial': /^how\s+to|tutorial|guide|learn\s+to|diy\s+|step\s+by\s+step/i,
    'review': /review|unboxing|first\s+impressions|tested|testing|comparison/i,
    'challenge': /challenge|24\s+hours|survive|last\s+to|trying\s+to/i,
    'reaction': /reacts?\s+to|reaction|responding\s+to|watches/i,
    'experiment': /experiment|what\s+happens\s+(if|when)|testing|myth/i,
    'explainer': /explained|what\s+is|why\s+does|how\s+does|the\s+science/i,
    'vlog': /vlog|day\s+in\s+(my|the)\s+life|daily\s+vlog|routine/i,
    'news': /breaking|update|news|announced|confirms|leaked/i,
    'interview': /interview|q\s*&\s*a|podcast|conversation\s+with/i
  };
  
  for (const [format, pattern] of Object.entries(patterns)) {
    if (pattern.test(title)) {
      return { format, confidence: 'medium' };
    }
  }
  
  return { format: 'other', confidence: 'low' };
}

// Method 3: LLM batch classification (Claude Haiku)
async function detectFormatByLLM(videos, batchSize = 20) {
  const results = [];
  const costs = { input_tokens: 0, output_tokens: 0, total_cost: 0 };
  
  // Process in batches
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    
    const prompt = `Classify each video title into ONE of these formats:
${Object.entries(VIDEO_FORMATS).map(([key, desc]) => `- ${key}: ${desc}`).join('\n')}

For each video, respond with ONLY the format key (e.g., "tutorial", "review", etc.).

Videos:
${batch.map((v, idx) => `${idx + 1}. "${v.title}"`).join('\n')}

Respond with a JSON array of format classifications in the same order as the videos.`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      });
      
      // Parse response
      const content = response.content[0].text;
      const formats = JSON.parse(content);
      
      // Add to results
      batch.forEach((video, idx) => {
        results.push({
          id: video.id,
          format: formats[idx] || 'other',
          confidence: 'high' // LLM classifications are considered high confidence
        });
      });
      
      // Track token usage
      costs.input_tokens += response.usage.input_tokens;
      costs.output_tokens += response.usage.output_tokens;
      
    } catch (error) {
      console.error(`Error in LLM batch ${i / batchSize + 1}:`, error.message);
      // Fallback to 'other' for failed batches
      batch.forEach(video => {
        results.push({
          id: video.id,
          format: 'other',
          confidence: 'low'
        });
      });
    }
    
    // Small delay to avoid rate limiting
    if (i + batchSize < videos.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Calculate costs (Claude Haiku pricing as of 2024)
  costs.total_cost = (costs.input_tokens * 0.00025 / 1000) + (costs.output_tokens * 0.00125 / 1000);
  
  return { results, costs };
}

// Method 4: Hybrid approach
async function detectFormatHybrid(video) {
  // First try keyword detection
  const keywordResult = detectFormatByKeywords(video.title);
  
  // If high confidence, use keyword result
  if (keywordResult.confidence === 'high') {
    return {
      format: keywordResult.format,
      confidence: keywordResult.confidence,
      method: 'keyword'
    };
  }
  
  // Try regex as secondary check
  const regexResult = detectFormatByRegex(video.title);
  if (regexResult.confidence === 'medium' && keywordResult.format === regexResult.format) {
    return {
      format: regexResult.format,
      confidence: 'high',
      method: 'keyword+regex'
    };
  }
  
  // For low confidence, would use LLM (but marking for batch processing)
  return {
    format: keywordResult.format || 'other',
    confidence: keywordResult.confidence,
    method: 'keyword',
    needsLLM: true
  };
}

// Create ground truth labels
function createGroundTruth(videos) {
  // This is a manual labeling based on the video titles
  // In a real scenario, this would be done by human annotators
  const groundTruth = {};
  
  videos.forEach(video => {
    const titleLower = video.title.toLowerCase();
    
    // Apply rules for ground truth labeling
    if (/^\d+\s+\w+|top\s+\d+|\d+\s+(ways|things|tips|tricks|reasons|facts)/i.test(video.title)) {
      groundTruth[video.id] = 'listicle';
    } else if (/^how\s+to|tutorial|guide|step[-\s]by[-\s]step/i.test(titleLower)) {
      groundTruth[video.id] = 'tutorial';
    } else if (/review|unboxing|tested|testing|comparison|vs\s+/i.test(titleLower)) {
      groundTruth[video.id] = 'review';
    } else if (/challenge|24\s+hour|survive|last\s+to|trying/i.test(titleLower)) {
      groundTruth[video.id] = 'challenge';
    } else if (/experiment|what\s+happens|testing.*myth|science\s+experiment/i.test(titleLower)) {
      groundTruth[video.id] = 'experiment';
    } else if (/explained|what\s+is|why\s+does|how\s+does|understanding/i.test(titleLower)) {
      groundTruth[video.id] = 'explainer';
    } else if (/vlog|day\s+in\s+(my|the)\s+life|routine/i.test(titleLower)) {
      groundTruth[video.id] = 'vlog';
    } else if (/breaking|update|news|announced|leaked/i.test(titleLower)) {
      groundTruth[video.id] = 'news';
    } else if (/interview|q\s*&\s*a|conversation\s+with|talks\s+with/i.test(titleLower)) {
      groundTruth[video.id] = 'interview';
    } else if (/reacts?\s+to|reaction|responding\s+to/i.test(titleLower)) {
      groundTruth[video.id] = 'reaction';
    } else if (/compilation|best\s+moments|highlights|collection/i.test(titleLower)) {
      groundTruth[video.id] = 'compilation';
    } else if (/case\s+study|deep\s+dive|analysis|breakdown/i.test(titleLower)) {
      groundTruth[video.id] = 'case_study';
    } else if (/documentary|story\s+of|history\s+of|inside\s+look/i.test(titleLower)) {
      groundTruth[video.id] = 'documentary';
    } else if (/story\s+time|what\s+happened|my\s+experience/i.test(titleLower)) {
      groundTruth[video.id] = 'story';
    } else {
      groundTruth[video.id] = 'other';
    }
  });
  
  return groundTruth;
}

// Calculate accuracy metrics
function calculateMetrics(predictions, groundTruth) {
  const formats = Object.keys(VIDEO_FORMATS);
  const confusionMatrix = {};
  let correct = 0;
  let total = 0;
  
  // Initialize confusion matrix
  formats.forEach(format => {
    confusionMatrix[format] = {};
    formats.forEach(f => confusionMatrix[format][f] = 0);
  });
  
  // Calculate predictions
  predictions.forEach(pred => {
    const actual = groundTruth[pred.id] || 'other';
    const predicted = pred.format || 'other';
    
    confusionMatrix[actual][predicted]++;
    if (actual === predicted) correct++;
    total++;
  });
  
  const accuracy = total > 0 ? (correct / total) : 0;
  
  // Calculate per-format metrics
  const perFormatMetrics = {};
  formats.forEach(format => {
    const tp = confusionMatrix[format][format];
    const fp = formats.reduce((sum, f) => sum + (f !== format ? confusionMatrix[f][format] : 0), 0);
    const fn = formats.reduce((sum, f) => sum + (f !== format ? confusionMatrix[format][f] : 0), 0);
    
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    perFormatMetrics[format] = { precision, recall, f1, support: tp + fn };
  });
  
  return { accuracy, confusionMatrix, perFormatMetrics };
}

// Generate comprehensive report
function generateReport(results, outputPath) {
  const report = {
    summary: {
      total_videos: results.total_videos,
      test_date: new Date().toISOString(),
      methods_tested: Object.keys(results.methods)
    },
    method_results: {},
    cost_analysis: results.costs,
    recommendations: []
  };
  
  // Add method results
  Object.entries(results.methods).forEach(([method, data]) => {
    report.method_results[method] = {
      accuracy: data.metrics.accuracy,
      processing_time_ms: data.processingTime,
      per_format_metrics: data.metrics.perFormatMetrics
    };
  });
  
  // Generate recommendations
  const accuracies = Object.entries(report.method_results).map(([method, data]) => ({
    method,
    accuracy: data.accuracy
  })).sort((a, b) => b.accuracy - a.accuracy);
  
  report.recommendations.push(`Best performing method: ${accuracies[0].method} with ${(accuracies[0].accuracy * 100).toFixed(1)}% accuracy`);
  
  if (results.costs.llm && results.costs.llm.total_cost < 0.10) {
    report.recommendations.push('LLM costs are reasonable for production use at current scale');
  }
  
  // Write report
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  
  // Also generate a markdown report
  const mdReport = `# Format Detection Test Report

## Summary
- **Total Videos Tested**: ${report.summary.total_videos}
- **Test Date**: ${new Date().toLocaleDateString()}
- **Methods Tested**: ${report.summary.methods_tested.join(', ')}

## Results by Method

${Object.entries(report.method_results).map(([method, data]) => `
### ${method.charAt(0).toUpperCase() + method.slice(1)} Method
- **Accuracy**: ${(data.accuracy * 100).toFixed(1)}%
- **Processing Time**: ${data.processing_time_ms}ms

#### Per-Format Performance
| Format | Precision | Recall | F1 Score | Support |
|--------|-----------|--------|----------|---------|
${Object.entries(data.per_format_metrics)
  .filter(([_, metrics]) => metrics.support > 0)
  .map(([format, metrics]) => 
    `| ${format} | ${(metrics.precision * 100).toFixed(1)}% | ${(metrics.recall * 100).toFixed(1)}% | ${(metrics.f1 * 100).toFixed(1)}% | ${metrics.support} |`
  ).join('\n')}
`).join('\n')}

## Cost Analysis
${results.costs.llm ? `
### LLM Costs (Claude Haiku)
- **Input Tokens**: ${results.costs.llm.input_tokens.toLocaleString()}
- **Output Tokens**: ${results.costs.llm.output_tokens.toLocaleString()}
- **Total Cost**: $${results.costs.llm.total_cost.toFixed(4)}
- **Cost per Video**: $${(results.costs.llm.total_cost / results.costs.llm.videos_processed).toFixed(5)}
` : 'No LLM costs (LLM method not tested)'}

## Recommendations
${report.recommendations.map(r => `- ${r}`).join('\n')}
`;
  
  fs.writeFileSync(outputPath.replace('.json', '.md'), mdReport);
  
  return report;
}

// Main test function
async function runTests() {
  console.log('Starting format detection tests...\n');
  
  // Load test data
  const videos = loadTestData();
  const results = {
    total_videos: videos.length,
    methods: {},
    costs: {}
  };
  
  // Create ground truth
  console.log('Creating ground truth labels...');
  const groundTruth = createGroundTruth(videos);
  
  // Save ground truth for inspection
  fs.writeFileSync(
    path.join(__dirname, '..', 'exports', 'format-detection-ground-truth.json'),
    JSON.stringify(groundTruth, null, 2)
  );
  
  // Test Method 1: Keyword-based
  console.log('\nTesting Method 1: Keyword-based scoring...');
  const startKeyword = Date.now();
  const keywordPredictions = videos.map(video => ({
    id: video.id,
    ...detectFormatByKeywords(video.title)
  }));
  const keywordTime = Date.now() - startKeyword;
  const keywordMetrics = calculateMetrics(keywordPredictions, groundTruth);
  results.methods.keyword = {
    predictions: keywordPredictions,
    metrics: keywordMetrics,
    processingTime: keywordTime
  };
  console.log(`✓ Keyword method: ${(keywordMetrics.accuracy * 100).toFixed(1)}% accuracy in ${keywordTime}ms`);
  
  // Test Method 2: Regex patterns
  console.log('\nTesting Method 2: Regex pattern matching...');
  const startRegex = Date.now();
  const regexPredictions = videos.map(video => ({
    id: video.id,
    ...detectFormatByRegex(video.title)
  }));
  const regexTime = Date.now() - startRegex;
  const regexMetrics = calculateMetrics(regexPredictions, groundTruth);
  results.methods.regex = {
    predictions: regexPredictions,
    metrics: regexMetrics,
    processingTime: regexTime
  };
  console.log(`✓ Regex method: ${(regexMetrics.accuracy * 100).toFixed(1)}% accuracy in ${regexTime}ms`);
  
  // Test Method 3: LLM (on subset)
  console.log('\nTesting Method 3: LLM classification (Claude Haiku)...');
  const llmSubset = videos.slice(0, 40); // Test on 40 videos to control costs
  
  // Cost estimation
  const estimatedTokens = llmSubset.length * 50; // ~50 tokens per video
  const estimatedCost = (estimatedTokens * 0.00025 / 1000) + (llmSubset.length * 10 * 0.00125 / 1000);
  console.log(`Estimated cost for ${llmSubset.length} videos: $${estimatedCost.toFixed(4)}`);
  
  if (process.env.ANTHROPIC_API_KEY) {
    const startLLM = Date.now();
    const { results: llmResults, costs: llmCosts } = await detectFormatByLLM(llmSubset);
    const llmTime = Date.now() - startLLM;
    
    // Map results back to full format
    const llmPredictions = llmResults.map(r => ({
      id: r.id,
      format: r.format,
      confidence: r.confidence
    }));
    
    const llmMetrics = calculateMetrics(llmPredictions, groundTruth);
    results.methods.llm = {
      predictions: llmPredictions,
      metrics: llmMetrics,
      processingTime: llmTime
    };
    results.costs.llm = {
      ...llmCosts,
      videos_processed: llmSubset.length
    };
    
    console.log(`✓ LLM method: ${(llmMetrics.accuracy * 100).toFixed(1)}% accuracy in ${llmTime}ms`);
    console.log(`  Actual cost: $${llmCosts.total_cost.toFixed(4)} (${llmCosts.input_tokens + llmCosts.output_tokens} total tokens)`);
  } else {
    console.log('⚠️  Skipping LLM test - ANTHROPIC_API_KEY not found');
  }
  
  // Test Method 4: Hybrid approach
  console.log('\nTesting Method 4: Hybrid approach...');
  const startHybrid = Date.now();
  const hybridResults = await Promise.all(videos.map(video => detectFormatHybrid(video)));
  const hybridPredictions = videos.map((video, idx) => ({
    id: video.id,
    format: hybridResults[idx].format,
    confidence: hybridResults[idx].confidence,
    method: hybridResults[idx].method
  }));
  const hybridTime = Date.now() - startHybrid;
  const hybridMetrics = calculateMetrics(hybridPredictions, groundTruth);
  results.methods.hybrid = {
    predictions: hybridPredictions,
    metrics: hybridMetrics,
    processingTime: hybridTime
  };
  
  // Count how many would need LLM in production
  const needsLLM = hybridResults.filter(r => r.needsLLM).length;
  console.log(`✓ Hybrid method: ${(hybridMetrics.accuracy * 100).toFixed(1)}% accuracy in ${hybridTime}ms`);
  console.log(`  Would need LLM for ${needsLLM} videos (${(needsLLM / videos.length * 100).toFixed(1)}%)`);
  
  // Generate comprehensive report
  console.log('\nGenerating comprehensive report...');
  const reportPath = path.join(__dirname, '..', 'exports', 'format-detection-test-report.json');
  const report = generateReport(results, reportPath);
  
  console.log(`\n✅ Test complete! Report saved to:`);
  console.log(`   - ${reportPath}`);
  console.log(`   - ${reportPath.replace('.json', '.md')}`);
  
  // Print summary
  console.log('\n📊 Summary:');
  console.log('Method Comparison:');
  Object.entries(results.methods).forEach(([method, data]) => {
    console.log(`  ${method}: ${(data.metrics.accuracy * 100).toFixed(1)}% accuracy`);
  });
  
  if (results.costs.llm) {
    console.log(`\n💰 Total LLM cost: $${results.costs.llm.total_cost.toFixed(4)}`);
  }
}

// Run tests
runTests().catch(console.error);