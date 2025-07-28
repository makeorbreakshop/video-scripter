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

// Core 7 topic-agnostic format definitions
const CORE_VIDEO_FORMATS = {
  'tutorial': 'Teaching how to do something - step-by-step instructions, demonstrations, skill-building',
  'review': 'Evaluating products/services - testing, analysis, pros/cons, recommendations',
  'showcase': 'Displaying work/results - portfolios, before/after, achievements, creations',
  'explanation': 'Breaking down concepts - educational content, answering "why/what/how" questions',
  'vlog': 'Personal journey/documentary - day-in-life, behind-scenes, personal experiences',
  'comparison': 'Analyzing alternatives - versus content, A/B testing, side-by-side analysis',
  'news': 'Updates/announcements - current events, breaking news, industry updates'
};

// Load test dataset
function loadTestData() {
  const filePath = path.join(__dirname, '..', 'exports', 'format-detection-sample-100-videos-2025-07-11.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`Loaded ${data.length} videos from test dataset`);
  
  // Use first 40 videos for fair comparison
  const subset = data.slice(0, 40);
  console.log(`Using subset of ${subset.length} videos for testing`);
  return subset;
}

// Create sophisticated prompt with few-shot examples
function createImprovedPrompt(videos) {
  const prompt = `You are an expert at classifying YouTube video content formats. Classify each video into exactly ONE of these 7 core formats:

# Video Format Definitions

## 1. TUTORIAL - Teaching how to do something
Key features: Step-by-step instructions, demonstrations, skill-building, educational guidance
Examples:
- "How to Build a Gaming PC - Complete Beginner's Guide 2024"
- "Master Python Functions in 15 Minutes - Programming Tutorial"
- "DIY Home Studio Setup - Professional Recording on a Budget"

## 2. REVIEW - Evaluating products/services
Key features: Testing, analysis, pros/cons lists, recommendations, ratings, verdicts
Examples:
- "iPhone 15 Pro Max Review After 6 Months - Still Worth It?"
- "Testing $5 vs $500 Art Supplies - Surprising Results!"
- "Honest Review: Is ChatGPT Plus Worth $20/Month?"

## 3. SHOWCASE - Displaying work/results
Key features: Portfolios, demonstrations of completed work, before/after, achievements
Examples:
- "My 30-Day Body Transformation Results"
- "Building My Dream Gaming Setup - Full Room Tour"
- "I Made 100 Pottery Pieces in 30 Days - Here Are The Results"

## 4. EXPLANATION - Breaking down concepts
Key features: Educational deep-dives, answering why/what/how questions, concept clarification
Examples:
- "Why Do We Dream? The Science Explained"
- "How Does Cryptocurrency Actually Work? Simple Explanation"
- "The Psychology Behind Social Media Addiction Explained"

## 5. VLOG - Personal journey/documentary
Key features: Day-in-life content, behind-the-scenes, personal experiences, diary-style
Examples:
- "Day in My Life as a Software Engineer in Silicon Valley"
- "Moving to Japan - My First Week Living in Tokyo"
- "Behind the Scenes: How I Film My Videos"

## 6. COMPARISON - Analyzing alternatives
Key features: Versus content, side-by-side analysis, A/B testing, decision-making help
Examples:
- "Mac vs PC for Video Editing in 2024 - Which Should You Buy?"
- "React vs Vue vs Angular - Which Framework is Best?"
- "Living in NYC vs LA - Cost, Lifestyle, and Career Comparison"

## 7. NEWS - Updates/announcements
Key features: Current events, breaking news, industry updates, new releases, announcements
Examples:
- "BREAKING: OpenAI Announces GPT-5 - Everything We Know"
- "Tesla Q4 Earnings Report - Stock Analysis and Predictions"
- "Nintendo Direct Summary - All Major Announcements"

# Classification Task

For each video below, respond with ONLY the format name (tutorial, review, showcase, explanation, vlog, comparison, or news) in lowercase.

Think carefully about the PRIMARY purpose and content type of each video. Some videos may have elements of multiple formats, but choose the ONE that best represents the main content.

Videos to classify:
${videos.map((v, idx) => `${idx + 1}. "${v.title}"`).join('\n')}

Respond with a JSON array containing the format classifications in the same order as the videos above. Example format:
["tutorial", "review", "vlog", "explanation", "comparison", "news", "showcase", ...]`;

  return prompt;
}

// Improved LLM classification with better prompting
async function classifyWithImprovedLLM(videos, batchSize = 20) {
  const results = [];
  const costs = { input_tokens: 0, output_tokens: 0, total_cost: 0 };
  
  // Process in batches
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    const prompt = createImprovedPrompt(batch);
    
    try {
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videos.length / batchSize)}...`);
      
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      });
      
      // Parse response
      const content = response.content[0].text;
      console.log(`Raw response: ${content.substring(0, 200)}...`); // Debug log
      
      // Try to extract JSON array from response
      let formats;
      try {
        // If response starts with text, find the JSON array
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          formats = JSON.parse(jsonMatch[0]);
        } else {
          formats = JSON.parse(content);
        }
      } catch (parseError) {
        console.error('Failed to parse formats:', parseError.message);
        console.error('Response content:', content);
        throw parseError;
      }
      
      // Validate formats
      const validFormats = Object.keys(CORE_VIDEO_FORMATS);
      formats.forEach((format, idx) => {
        if (!validFormats.includes(format)) {
          console.warn(`Invalid format "${format}" for video: ${batch[idx].title}`);
        }
      });
      
      // Add to results
      batch.forEach((video, idx) => {
        results.push({
          id: video.id,
          title: video.title,
          format: formats[idx] || 'explanation', // Default to explanation if invalid
          confidence: 'high' // LLM with improved prompting
        });
      });
      
      // Track token usage
      costs.input_tokens += response.usage.input_tokens;
      costs.output_tokens += response.usage.output_tokens;
      
    } catch (error) {
      console.error(`Error in LLM batch ${i / batchSize + 1}:`, error.message);
      // Fallback
      batch.forEach(video => {
        results.push({
          id: video.id,
          title: video.title,
          format: 'explanation',
          confidence: 'low'
        });
      });
    }
    
    // Small delay to avoid rate limiting
    if (i + batchSize < videos.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Calculate costs (Claude Haiku pricing)
  costs.total_cost = (costs.input_tokens * 0.00025 / 1000) + (costs.output_tokens * 0.00125 / 1000);
  
  return { results, costs };
}

// Create manual ground truth for the core formats
function createCoreFormatGroundTruth(videos) {
  const groundTruth = {};
  
  videos.forEach(video => {
    const titleLower = video.title.toLowerCase();
    
    // Apply rules for ground truth labeling with core formats
    if (/^how\s+to|tutorial|guide|step[-\s]by[-\s]step|learn\s+to|diy\s+/i.test(titleLower)) {
      groundTruth[video.id] = 'tutorial';
    } else if (/review|unboxing|tested|testing|worth\s+it|honest\s+opinion/i.test(titleLower) && 
               !/vs\s+|versus|comparison/i.test(titleLower)) {
      groundTruth[video.id] = 'review';
    } else if (/my\s+.*results|i\s+(made|built|created)|room\s+tour|setup\s+tour|transformation|portfolio/i.test(titleLower)) {
      groundTruth[video.id] = 'showcase';
    } else if (/explained|what\s+is|why\s+does|how\s+does|understanding|science\s+of|psychology\s+of/i.test(titleLower)) {
      groundTruth[video.id] = 'explanation';
    } else if (/vlog|day\s+in\s+(my|the)\s+life|behind\s+the\s+scenes|morning\s+routine|week\s+in\s+my\s+life/i.test(titleLower)) {
      groundTruth[video.id] = 'vlog';
    } else if (/vs\s+|versus|comparison|comparing|which\s+is\s+better|a\s+or\s+b/i.test(titleLower)) {
      groundTruth[video.id] = 'comparison';
    } else if (/breaking|update|news|announced|leaked|confirms|reports|q\d\s+earnings/i.test(titleLower)) {
      groundTruth[video.id] = 'news';
    } else {
      // Default to explanation for educational/informative content
      groundTruth[video.id] = 'explanation';
    }
  });
  
  return groundTruth;
}

// Calculate accuracy metrics
function calculateMetrics(predictions, groundTruth) {
  const formats = Object.keys(CORE_VIDEO_FORMATS);
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
    const actual = groundTruth[pred.id] || 'explanation';
    const predicted = pred.format || 'explanation';
    
    if (confusionMatrix[actual] && confusionMatrix[actual][predicted] !== undefined) {
      confusionMatrix[actual][predicted]++;
    }
    if (actual === predicted) correct++;
    total++;
  });
  
  const accuracy = total > 0 ? (correct / total) : 0;
  
  // Calculate per-format metrics
  const perFormatMetrics = {};
  formats.forEach(format => {
    const tp = confusionMatrix[format][format] || 0;
    const fp = formats.reduce((sum, f) => sum + (f !== format ? (confusionMatrix[f][format] || 0) : 0), 0);
    const fn = formats.reduce((sum, f) => sum + (f !== format ? (confusionMatrix[format][f] || 0) : 0), 0);
    
    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    
    perFormatMetrics[format] = { precision, recall, f1, support: tp + fn };
  });
  
  return { accuracy, confusionMatrix, perFormatMetrics };
}

// Generate detailed comparison report
function generateComparisonReport(improvedResults, previousResults, outputPath) {
  const report = {
    test_info: {
      date: new Date().toISOString(),
      videos_tested: improvedResults.videos_tested,
      prompt_type: 'improved_few_shot_with_examples'
    },
    improved_method: {
      accuracy: improvedResults.accuracy,
      tokens_used: improvedResults.costs.input_tokens + improvedResults.costs.output_tokens,
      total_cost: improvedResults.costs.total_cost,
      cost_per_video: improvedResults.costs.total_cost / improvedResults.videos_tested,
      per_format_performance: improvedResults.perFormatMetrics
    },
    comparison: {
      accuracy_improvement: null,
      cost_difference: null,
      format_distribution: {}
    },
    detailed_results: improvedResults.predictions
  };
  
  // Calculate format distribution
  const formatCounts = {};
  Object.keys(CORE_VIDEO_FORMATS).forEach(f => formatCounts[f] = 0);
  improvedResults.predictions.forEach(pred => {
    if (formatCounts[pred.format] !== undefined) {
      formatCounts[pred.format]++;
    }
  });
  report.comparison.format_distribution = formatCounts;
  
  // Write JSON report
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  
  // Generate markdown report
  const mdReport = `# Improved Format Classification Test Report

## Test Information
- **Date**: ${new Date().toLocaleDateString()}
- **Videos Tested**: ${report.test_info.videos_tested}
- **Method**: Few-shot prompting with examples for 7 core formats

## Results Summary

### Overall Performance
- **Accuracy**: ${(report.improved_method.accuracy * 100).toFixed(1)}%
- **Total Tokens**: ${report.improved_method.tokens_used.toLocaleString()}
- **Total Cost**: $${report.improved_method.total_cost.toFixed(4)}
- **Cost per Video**: $${report.improved_method.cost_per_video.toFixed(5)}

### Per-Format Performance
| Format | Precision | Recall | F1 Score | Support |
|--------|-----------|--------|----------|---------|
${Object.entries(report.improved_method.per_format_performance)
  .map(([format, metrics]) => 
    `| ${format} | ${(metrics.precision * 100).toFixed(1)}% | ${(metrics.recall * 100).toFixed(1)}% | ${(metrics.f1 * 100).toFixed(1)}% | ${metrics.support} |`
  ).join('\n')}

### Format Distribution
${Object.entries(report.comparison.format_distribution)
  .map(([format, count]) => `- **${format}**: ${count} videos (${(count / report.test_info.videos_tested * 100).toFixed(1)}%)`)
  .join('\n')}

## Improved Prompt Engineering Features

1. **Clear Format Definitions**: Each format has explicit key features and distinguishing characteristics
2. **Few-Shot Examples**: 3 example titles per format to guide classification
3. **Disambiguation Guidelines**: Clear instructions for handling edge cases
4. **Simplified Categories**: Reduced from 15 to 7 core topic-agnostic formats

## Cost Analysis

- **Token Efficiency**: Using ${Math.round(report.improved_method.tokens_used / report.test_info.videos_tested)} tokens per video on average
- **Scalability**: At $${report.improved_method.cost_per_video.toFixed(5)} per video, processing 10,000 videos would cost approximately $${(report.improved_method.cost_per_video * 10000).toFixed(2)}

## Recommendations

1. The improved prompt engineering with few-shot examples provides clearer classification guidelines
2. The 7 core formats are more generalizable across different content topics
3. Cost remains reasonable for production use at scale
4. Consider implementing a confidence threshold for manual review of edge cases
`;
  
  fs.writeFileSync(outputPath.replace('.json', '.md'), mdReport);
  
  return report;
}

// Main test function
async function runImprovedTest() {
  console.log('Starting improved format classification test...\n');
  
  // Load test data
  const videos = loadTestData();
  
  // Create ground truth for core formats
  console.log('Creating ground truth labels for core formats...');
  const groundTruth = createCoreFormatGroundTruth(videos);
  
  // Save ground truth
  const groundTruthPath = path.join(__dirname, '..', 'exports', 'format-classification-ground-truth-core.json');
  fs.writeFileSync(groundTruthPath, JSON.stringify(groundTruth, null, 2));
  
  // Test improved LLM method
  console.log('\nTesting improved LLM classification with few-shot prompting...');
  console.log('Using 7 core topic-agnostic formats with example titles...\n');
  
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
    process.exit(1);
  }
  
  const startTime = Date.now();
  const { results: predictions, costs } = await classifyWithImprovedLLM(videos);
  const processingTime = Date.now() - startTime;
  
  // Calculate metrics
  const metrics = calculateMetrics(predictions, groundTruth);
  
  // Prepare results
  const improvedResults = {
    videos_tested: videos.length,
    predictions,
    accuracy: metrics.accuracy,
    perFormatMetrics: metrics.perFormatMetrics,
    confusionMatrix: metrics.confusionMatrix,
    costs,
    processingTime
  };
  
  // Generate report
  console.log('\nGenerating comparison report...');
  const reportPath = path.join(__dirname, '..', 'exports', 'format-classification-improved-test-report.json');
  const report = generateComparisonReport(improvedResults, null, reportPath);
  
  // Print summary
  console.log('\n✅ Test complete!\n');
  console.log('📊 Results Summary:');
  console.log(`   - Accuracy: ${(metrics.accuracy * 100).toFixed(1)}%`);
  console.log(`   - Processing time: ${(processingTime / 1000).toFixed(1)}s`);
  console.log(`   - Total cost: $${costs.total_cost.toFixed(4)}`);
  console.log(`   - Cost per video: $${(costs.total_cost / videos.length).toFixed(5)}`);
  console.log(`   - Tokens used: ${costs.input_tokens + costs.output_tokens}`);
  
  console.log('\n📈 Per-Format Performance:');
  Object.entries(metrics.perFormatMetrics)
    .filter(([_, m]) => m.support > 0)
    .forEach(([format, m]) => {
      console.log(`   ${format}: F1=${(m.f1 * 100).toFixed(1)}% (${m.support} videos)`);
    });
  
  console.log('\n📁 Reports saved to:');
  console.log(`   - ${reportPath}`);
  console.log(`   - ${reportPath.replace('.json', '.md')}`);
  console.log(`   - ${groundTruthPath}`);
  
  // Show some example classifications
  console.log('\n🎯 Example Classifications:');
  predictions.slice(0, 5).forEach(pred => {
    const actual = groundTruth[pred.id];
    const match = pred.format === actual ? '✓' : '✗';
    console.log(`   ${match} "${pred.title}"`);
    console.log(`      Predicted: ${pred.format}, Actual: ${actual}`);
  });
}

// Run the improved test
runImprovedTest().catch(console.error);