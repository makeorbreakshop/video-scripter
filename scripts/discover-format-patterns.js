#!/usr/bin/env node

/**
 * Discover format patterns from video titles
 * This will identify common patterns like "Top X", "X vs Y", etc.
 */

import fs from 'fs';

const inputFile = '/Users/brandoncullum/video-scripter/exports/format-analysis/titles-for-analysis-2025-07-10.json';
const outputDir = '/Users/brandoncullum/video-scripter/exports/format-analysis';

// Define pattern detectors
const formatPatterns = [
  // List/Number formats
  { name: 'Top X List', regex: /^(top|best)\s+\d+/i, examples: [] },
  { name: 'Numbered List', regex: /^\d+\s+(ways|things|tips|tricks|reasons|facts)/i, examples: [] },
  { name: 'X Things About Y', regex: /\d+\s+(things|facts|secrets).*about/i, examples: [] },
  
  // Comparison formats
  { name: 'X vs Y', regex: /\bvs\.?\s+|versus\b/i, examples: [] },
  { name: 'X or Y', regex: /\bor\b.*\?/i, examples: [] },
  
  // Challenge/Test formats
  { name: 'Challenge', regex: /challenge|challenged/i, examples: [] },
  { name: 'Testing/Trying', regex: /^(testing|trying|test)\s+/i, examples: [] },
  { name: 'I Tried X', regex: /^i\s+(tried|tested|bought|made|built)/i, examples: [] },
  { name: 'Can You X', regex: /^can\s+you\s+/i, examples: [] },
  { name: 'Will It X', regex: /^will\s+it\s+/i, examples: [] },
  
  // Time-based formats
  { name: 'X in Y Time', regex: /in\s+\d+\s*(hours?|minutes?|seconds?|days?|weeks?)/i, examples: [] },
  { name: 'X Day Challenge', regex: /\d+\s*days?\s*(challenge|experiment)/i, examples: [] },
  { name: '24 Hours', regex: /24\s*hours?/i, examples: [] },
  
  // Question formats
  { name: 'How To', regex: /^how\s+to\s+/i, examples: [] },
  { name: 'What Happens', regex: /^what\s+happens/i, examples: [] },
  { name: 'Why Question', regex: /^why\s+/i, examples: [] },
  { name: 'What If', regex: /^what\s+if\s+/i, examples: [] },
  { name: 'Question Mark', regex: /\?$/, examples: [] },
  
  // Superlative formats
  { name: 'World\'s Most/Largest', regex: /world'?s?\s+(largest|biggest|most|best|worst|first)/i, examples: [] },
  { name: 'Ultimate', regex: /\bultimate\b/i, examples: [] },
  { name: 'Ever/Never', regex: /\b(ever|never)\b/i, examples: [] },
  
  // Tutorial/Guide formats
  { name: 'Tutorial', regex: /tutorial|guide|how-to/i, examples: [] },
  { name: 'DIY', regex: /\bDIY\b/i, examples: [] },
  { name: 'Build/Make', regex: /^(building|making|build|make)\s+/i, examples: [] },
  
  // Reaction/Review formats
  { name: 'Reacting To', regex: /react(ing|s)?\s+to/i, examples: [] },
  { name: 'Review', regex: /review|unboxing/i, examples: [] },
  { name: 'First Time', regex: /first\s+time/i, examples: [] },
  
  // Story/Personal formats
  { name: 'My Story', regex: /^(my|i)\s+/i, examples: [] },
  { name: 'Story Time', regex: /story\s*time/i, examples: [] },
  { name: 'Life Hack', regex: /life\s*hack/i, examples: [] },
  
  // Clickbait elements
  { name: 'Gone Wrong', regex: /gone\s+(wrong|bad)/i, examples: [] },
  { name: 'You Won\'t Believe', regex: /you\s+won'?t\s+believe/i, examples: [] },
  { name: 'Shocking/Insane', regex: /\b(shocking|insane|crazy|unbelievable)\b/i, examples: [] },
  { name: 'HACK', regex: /\bHACK\b/, examples: [] },
  
  // Money/Cost formats
  { name: 'Dollar Amount', regex: /\$\d+/i, examples: [] },
  { name: 'Cheap vs Expensive', regex: /cheap.*expensive|expensive.*cheap/i, examples: [] },
  { name: 'Worth It?', regex: /worth\s+it\?/i, examples: [] },
  
  // Transformation formats
  { name: 'Turning X into Y', regex: /turning.*into/i, examples: [] },
  { name: 'From X to Y', regex: /from.*to\s+/i, examples: [] },
  { name: 'Before/After', regex: /before.*after|after.*before/i, examples: [] },
  
  // Scientific/Experiment
  { name: 'Experiment', regex: /experiment/i, examples: [] },
  { name: 'Science/Scientific', regex: /scienc(e|tific)/i, examples: [] },
  { name: 'What Happens When', regex: /what\s+happens\s+(when|if)/i, examples: [] },
];

function analyzeFormats() {
  console.log('🔍 Discovering format patterns from video titles...\n');
  
  // Load titles
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const titles = data.map(v => ({ title: v.title, views: v.views, tier: v.tier }));
  
  console.log(`📊 Analyzing ${titles.length} video titles...\n`);
  
  // Track unmatched titles
  const unmatchedTitles = [];
  
  // Analyze each title
  titles.forEach(video => {
    let matched = false;
    
    formatPatterns.forEach(pattern => {
      if (pattern.regex.test(video.title)) {
        pattern.examples.push(video);
        matched = true;
      }
    });
    
    if (!matched) {
      unmatchedTitles.push(video);
    }
  });
  
  // Sort patterns by frequency
  const sortedPatterns = formatPatterns
    .filter(p => p.examples.length > 0)
    .sort((a, b) => b.examples.length - a.examples.length);
  
  // Display results
  console.log('📈 Format Pattern Distribution:\n');
  sortedPatterns.forEach(pattern => {
    const percentage = ((pattern.examples.length / titles.length) * 100).toFixed(1);
    console.log(`${pattern.name}: ${pattern.examples.length} videos (${percentage}%)`);
    
    // Show top 3 examples
    const topExamples = pattern.examples
      .sort((a, b) => b.views - a.views)
      .slice(0, 3);
    
    topExamples.forEach(ex => {
      console.log(`  - "${ex.title}" (${ex.views.toLocaleString()} views)`);
    });
    console.log('');
  });
  
  // Analyze performance by format
  console.log('\n📊 Performance Analysis by Format:\n');
  
  const performanceByFormat = sortedPatterns.map(pattern => {
    const avgViews = pattern.examples.reduce((sum, v) => sum + v.views, 0) / pattern.examples.length;
    const viralCount = pattern.examples.filter(v => v.tier === 'mega-viral' || v.tier === 'viral').length;
    const viralRate = (viralCount / pattern.examples.length * 100).toFixed(1);
    
    return {
      name: pattern.name,
      count: pattern.examples.length,
      avgViews: Math.round(avgViews),
      viralRate: parseFloat(viralRate)
    };
  }).sort((a, b) => b.avgViews - a.avgViews);
  
  console.log('Top Performing Formats (by average views):');
  performanceByFormat.slice(0, 10).forEach(format => {
    console.log(`${format.name}:`);
    console.log(`  Avg views: ${format.avgViews.toLocaleString()}`);
    console.log(`  Viral rate: ${format.viralRate}%`);
    console.log(`  Sample size: ${format.count} videos\n`);
  });
  
  // Save detailed results
  const results = {
    metadata: {
      totalVideos: titles.length,
      patternsFound: sortedPatterns.length,
      coverageRate: ((titles.length - unmatchedTitles.length) / titles.length * 100).toFixed(1) + '%'
    },
    patterns: sortedPatterns.map(p => ({
      name: p.name,
      regex: p.regex.toString(),
      count: p.examples.length,
      percentage: ((p.examples.length / titles.length) * 100).toFixed(1) + '%',
      topExamples: p.examples
        .sort((a, b) => b.views - a.views)
        .slice(0, 10)
        .map(v => ({ title: v.title, views: v.views }))
    })),
    performanceAnalysis: performanceByFormat,
    unmatchedSample: unmatchedTitles.slice(0, 100)
  };
  
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = `${outputDir}/format-patterns-discovered-${timestamp}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log(`\n✅ Detailed results saved to: ${outputFile}`);
  
  // Analyze unmatched titles
  console.log(`\n🤔 Unmatched titles: ${unmatchedTitles.length} (${(unmatchedTitles.length / titles.length * 100).toFixed(1)}%)`);
  console.log('\nSample unmatched titles:');
  unmatchedTitles.slice(0, 5).forEach(v => {
    console.log(`  - "${v.title}"`);
  });
}

analyzeFormats();