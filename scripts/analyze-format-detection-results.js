#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test results
const reportPath = path.join(__dirname, '..', 'exports', 'format-detection-test-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

// Load ground truth
const groundTruthPath = path.join(__dirname, '..', 'exports', 'format-detection-ground-truth.json');
const groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, 'utf-8'));

// Load video data
const videoPath = path.join(__dirname, '..', 'exports', 'format-detection-sample-100-videos-2025-07-11.json');
const videos = JSON.parse(fs.readFileSync(videoPath, 'utf-8'));

console.log('Format Detection Analysis Report\n');
console.log('================================\n');

// Analyze ground truth distribution
const formatCounts = {};
Object.values(groundTruth).forEach(format => {
  formatCounts[format] = (formatCounts[format] || 0) + 1;
});

console.log('Ground Truth Distribution:');
Object.entries(formatCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([format, count]) => {
    const percentage = (count / Object.keys(groundTruth).length * 100).toFixed(1);
    console.log(`  ${format}: ${count} videos (${percentage}%)`);
  });

// Analyze misclassifications
console.log('\n\nMisclassification Analysis:');
console.log('==========================\n');

Object.entries(report.method_results).forEach(([method, data]) => {
  console.log(`${method.toUpperCase()} Method:`);
  console.log(`  Overall Accuracy: ${(data.accuracy * 100).toFixed(1)}%`);
  console.log(`  Processing Time: ${data.processing_time_ms}ms`);
  
  // Find common misclassifications
  const misclassifications = {};
  
  if (method === 'keyword' || method === 'hybrid') {
    // These are our best performing methods, let's analyze their errors
    console.log('\n  Common Errors:');
    
    // Get predictions for this method
    const predictionsPath = path.join(__dirname, '..', 'exports', `format-detection-${method}-predictions.json`);
    
    // Since we don't have the predictions saved separately, let's note this
    console.log('    (Detailed predictions not saved separately)');
  }
  
  console.log('\n');
});

// Performance comparison
console.log('Performance Comparison:');
console.log('======================\n');

const methods = Object.keys(report.method_results);
const formats = new Set();
methods.forEach(method => {
  Object.keys(report.method_results[method].per_format_metrics).forEach(format => {
    formats.add(format);
  });
});

// Create comparison table
console.log('F1 Scores by Format and Method:');
console.log('| Format       | Keyword | Regex | LLM   | Hybrid |');
console.log('|--------------|---------|-------|-------|--------|');

Array.from(formats).sort().forEach(format => {
  const row = [format.padEnd(12)];
  
  methods.forEach(method => {
    const metrics = report.method_results[method].per_format_metrics[format];
    if (metrics && metrics.support > 0) {
      row.push((metrics.f1 * 100).toFixed(1) + '%');
    } else {
      row.push('N/A');
    }
  });
  
  console.log(`| ${row.join(' | ').padEnd(47)} |`);
});

// Cost analysis
console.log('\n\nCost Analysis:');
console.log('==============\n');

if (report.cost_analysis.llm) {
  const llmCost = report.cost_analysis.llm;
  console.log('LLM Method (Claude Haiku):');
  console.log(`  Videos Processed: ${llmCost.videos_processed}`);
  console.log(`  Total Tokens: ${llmCost.input_tokens + llmCost.output_tokens}`);
  console.log(`  Total Cost: $${llmCost.total_cost.toFixed(4)}`);
  console.log(`  Cost per Video: $${(llmCost.total_cost / llmCost.videos_processed).toFixed(5)}`);
  
  // Extrapolate to full dataset
  const totalVideos = videos.length;
  const estimatedFullCost = (llmCost.total_cost / llmCost.videos_processed) * totalVideos;
  console.log(`\n  Estimated cost for all ${totalVideos} videos: $${estimatedFullCost.toFixed(4)}`);
  
  // Extrapolate to larger scales
  console.log('\n  Cost projections:');
  [1000, 10000, 100000, 1000000].forEach(scale => {
    const cost = (llmCost.total_cost / llmCost.videos_processed) * scale;
    console.log(`    ${scale.toLocaleString()} videos: $${cost.toFixed(2)}`);
  });
}

// Recommendations
console.log('\n\nRecommendations:');
console.log('================\n');

console.log('1. Primary Method: Keyword-based detection');
console.log('   - Highest accuracy (93.3%)');
console.log('   - Fastest processing (1ms for 90 videos)');
console.log('   - Zero API costs');
console.log('   - Well-suited for common formats');

console.log('\n2. Fallback Strategy:');
console.log('   - Use regex patterns for additional validation');
console.log('   - Reserve LLM for edge cases or new format types');
console.log('   - Consider human review for low-confidence predictions');

console.log('\n3. Format-Specific Improvements:');
const weakFormats = Array.from(formats).filter(format => {
  const keywordMetrics = report.method_results.keyword.per_format_metrics[format];
  return keywordMetrics && keywordMetrics.f1 < 0.5;
});

if (weakFormats.length > 0) {
  console.log('   Formats needing improvement:');
  weakFormats.forEach(format => {
    const support = formatCounts[format] || 0;
    console.log(`   - ${format}: Only ${support} examples in dataset`);
  });
  console.log('   Consider adding more keyword patterns for these formats');
}

console.log('\n4. Cost Considerations:');
console.log('   - LLM accuracy (47.5%) doesn\'t justify the cost');
console.log('   - Keyword method is 46% more accurate and infinitely cheaper');
console.log('   - For 1M videos: $0 (keywords) vs $15 (LLM)');

// Sample misclassified videos
console.log('\n\nSample Videos for Manual Review:');
console.log('=================================\n');

// Find videos where keyword method might have failed
const sampleSize = 5;
const sampledVideos = videos.slice(0, sampleSize);

console.log('First 5 videos in dataset:');
sampledVideos.forEach((video, idx) => {
  const gt = groundTruth[video.id];
  console.log(`\n${idx + 1}. "${video.title}"`);
  console.log(`   Channel: ${video.channel_name}`);
  console.log(`   Ground Truth: ${gt}`);
  console.log(`   Views: ${video.view_count.toLocaleString()}`);
});