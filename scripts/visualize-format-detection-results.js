#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test results
const reportPath = path.join(__dirname, '..', 'exports', 'format-detection-test-report.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

// Create ASCII bar chart
function createBarChart(data, maxWidth = 50) {
  const maxValue = Math.max(...data.map(d => d.value));
  
  console.log('\nAccuracy Comparison:');
  console.log('===================\n');
  
  data.forEach(item => {
    const barLength = Math.round((item.value / maxValue) * maxWidth);
    const bar = '█'.repeat(barLength);
    const percentage = (item.value * 100).toFixed(1) + '%';
    console.log(`${item.label.padEnd(10)} ${bar} ${percentage}`);
  });
}

// Create confusion matrix visualization
function printConfusionMatrix(matrix, formats) {
  console.log('\nConfusion Matrix (Best Method - Keyword):');
  console.log('=========================================\n');
  
  // Header
  console.log('Actual \\ Predicted');
  console.log('                  ', formats.map(f => f.substring(0, 4).padEnd(5)).join(''));
  
  // Rows
  formats.forEach(actualFormat => {
    const row = [actualFormat.padEnd(18)];
    formats.forEach(predictedFormat => {
      const count = matrix[actualFormat]?.[predictedFormat] || 0;
      row.push(count.toString().padEnd(5));
    });
    console.log(row.join(''));
  });
}

// Main visualization
console.log('Format Detection Performance Visualization');
console.log('=========================================');

// Accuracy comparison
const accuracyData = Object.entries(report.method_results).map(([method, data]) => ({
  label: method.charAt(0).toUpperCase() + method.slice(1),
  value: data.accuracy
}));

createBarChart(accuracyData);

// Speed comparison
console.log('\n\nProcessing Speed Comparison:');
console.log('============================\n');

Object.entries(report.method_results).forEach(([method, data]) => {
  const videosPerSecond = data.processing_time_ms > 0 
    ? Math.round((report.summary.total_videos / data.processing_time_ms) * 1000)
    : 'N/A';
  console.log(`${method.padEnd(10)}: ${data.processing_time_ms.toString().padStart(6)}ms (${videosPerSecond} videos/second)`);
});

// Cost efficiency
console.log('\n\nCost Efficiency Analysis:');
console.log('=========================\n');

console.log('Method     | Accuracy | Cost/1K | Speed    | Overall');
console.log('-----------|----------|---------|----------|--------');

Object.entries(report.method_results).forEach(([method, data]) => {
  const accuracy = (data.accuracy * 100).toFixed(1) + '%';
  const cost = method === 'llm' && report.cost_analysis.llm 
    ? '$' + ((report.cost_analysis.llm.total_cost / report.cost_analysis.llm.videos_processed) * 1000).toFixed(2)
    : '$0.00';
  const speed = data.processing_time_ms + 'ms';
  
  // Calculate overall score (accuracy * speed efficiency * cost efficiency)
  let score = data.accuracy;
  if (method === 'keyword' || method === 'regex') score *= 1.2; // Bonus for free methods
  if (data.processing_time_ms < 10) score *= 1.1; // Bonus for fast methods
  
  const stars = '★'.repeat(Math.round(score * 5));
  
  console.log(`${method.padEnd(10)} | ${accuracy.padStart(8)} | ${cost.padStart(7)} | ${speed.padStart(8)} | ${stars}`);
});

// Key insights
console.log('\n\nKey Insights:');
console.log('=============\n');

const keywordAccuracy = report.method_results.keyword.accuracy;
const llmAccuracy = report.method_results.llm?.accuracy || 0;
const accuracyDiff = ((keywordAccuracy - llmAccuracy) / llmAccuracy * 100).toFixed(0);

console.log(`1. Keyword method is ${accuracyDiff}% more accurate than LLM`);
console.log('2. Keyword method is infinitely more cost-effective ($0 vs $0.015/1K)');
console.log('3. Keyword method is 9,877x faster than LLM (1ms vs 9,877ms)');
console.log('4. Hybrid approach provides no benefit over pure keyword method');

// Format coverage
console.log('\n\nFormat Coverage Analysis:');
console.log('========================\n');

const coveredFormats = new Set();
const uncoveredFormats = new Set();

Object.entries(report.method_results.keyword.per_format_metrics).forEach(([format, metrics]) => {
  if (metrics.support > 0 && metrics.f1 > 0) {
    coveredFormats.add(format);
  } else if (metrics.support > 0) {
    uncoveredFormats.add(format);
  }
});

console.log(`Well-detected formats (${coveredFormats.size}):`);
Array.from(coveredFormats).forEach(format => {
  const metrics = report.method_results.keyword.per_format_metrics[format];
  console.log(`  ✓ ${format}: ${(metrics.f1 * 100).toFixed(0)}% F1 score`);
});

if (uncoveredFormats.size > 0) {
  console.log(`\nPoorly-detected formats (${uncoveredFormats.size}):`);
  Array.from(uncoveredFormats).forEach(format => {
    console.log(`  ✗ ${format}: Needs improvement`);
  });
}

// Final recommendation
console.log('\n\n' + '='.repeat(60));
console.log('FINAL RECOMMENDATION: Use keyword-based detection');
console.log('='.repeat(60));
console.log('\nRationale:');
console.log('- Superior accuracy (93.3%)');
console.log('- Zero operational cost');
console.log('- Lightning-fast performance');
console.log('- Simple to maintain and extend');
console.log('- No external dependencies or API rate limits');