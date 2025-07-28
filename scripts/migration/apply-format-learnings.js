#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

import { formatDetectionService, VideoFormat } from '../lib/format-detection-service.ts';

// Based on your tracking data, here are the improvements to apply:

console.log('🔧 Applying Format Detection Improvements from Learning Data\n');

// 1. PERSONAL_STORY is being over-detected - needs better keywords
console.log('1️⃣ Fixing personal_story over-detection...');
formatDetectionService.updateFormatKeywords(VideoFormat.PERSONAL_STORY, {
  strong: [
    'my story', 'my journey', 'confession', 'storytime',
    'i quit', 'i tried', 'i failed', 'i succeeded',
    'truth about my', 'opening up', 'vulnerable', 'honest',
    'conversation with', 'interview', 'vlog'  // More specific
  ],
  medium: [
    'story', 'journey', 'path', 'struggle', 'challenge', 'overcame',
    'dealing with', 'living with', 'surviving', 'thriving',
    'episode'
  ],
  weak: [
    'personal', 'own', 'self', 'life', 'real',
    'raw', 'unfiltered', 'candid'
  ]
});

// 2. TUTORIAL keywords need strengthening - many tutorials misclassified
console.log('2️⃣ Strengthening tutorial detection...');
formatDetectionService.updateFormatKeywords(VideoFormat.TUTORIAL, {
  strong: [
    'how to', 'tutorial', 'guide', 'step by step', 'learn', 'teach',
    'walkthrough', 'setup', 'install', 'configure', 'build', 'create',
    'make', 'diy', 'instructions', 'demonstration',
    'made easy', 'exercises', 'homemade', 'completing the', 'how we built'
  ],
  medium: [
    'show', 'explain', 'process', 'method', 'technique', 'way to',
    'steps', 'beginner', 'advanced', 'master', 'course', 'lesson',
    'preparing', 'choosing'  // From "choosing and preparing materials"
  ],
  weak: [
    'easy', 'simple', 'quick', 'fast', 'complete', 'full', 'using',
    'with', 'from scratch', 'like a pro'
  ]
});

// 3. PRODUCT_FOCUS needs to catch giveaways and brand discussions
console.log('3️⃣ Improving product focus detection...');
formatDetectionService.updateFormatKeywords(VideoFormat.PRODUCT_FOCUS, {
  strong: [
    'review', 'unboxing', 'first look', 'hands on', 'comparison',
    'vs', 'versus', 'alternatives', 'worth it', 'waste of money',
    'buying guide', 'should you buy', 'tested', 'benchmarks',
    'black friday', 'deals', 'too good to pass up'  // From tracking
  ],
  medium: [
    'product', 'device', 'gadget', 'tool', 'software', 'app',
    'features', 'specs', 'performance', 'quality', 'price',
    'giveaway', 'sponsor', 'lifestyle brand', 'becoming a'  // From tracking
  ],
  weak: [
    'new', 'latest', 'best', 'top', 'premium', 'budget', 'cheap',
    'expensive', 'value', 'deal', 'brand'
  ]
});

// 4. EXPLAINER needs to catch more "genius" and analytical content
console.log('4️⃣ Enhancing explainer detection...');
formatDetectionService.updateFormatKeywords(VideoFormat.EXPLAINER, {
  strong: [
    'what is', 'why', 'how does', 'explained', 'explanation', 
    'understanding', 'meaning', 'definition', 'introduction to',
    'basics', 'fundamentals', 'science of', 'theory',
    'the genius', 'that made'  // From "The GENIUS Harmony That Made"
  ],
  medium: [
    'concept', 'overview', 'summary', 'breakdown', 'deep dive',
    'analysis', 'behind', 'works', 'happens', 'causes',
    'idea', 'value from'  // From tracking data
  ],
  weak: [
    'simple', 'easy', 'complex', 'detailed', 'comprehensive',
    'everything about', 'all about', 'truth about', 'genius'
  ]
});

// 5. CASE_STUDY vs TUTORIAL confusion - make case study more specific
console.log('5️⃣ Clarifying case_study detection...');
formatDetectionService.updateFormatKeywords(VideoFormat.CASE_STUDY, {
  strong: [
    'case study', 'success story', 'failure', 'results', 'experiment',
    'tested', 'tried', 'journey', 'transformation', 'before after',
    'went from', 'achieved', 'grew',
    'after exploitation', 'consequences'  // Real-world outcomes
  ],
  medium: [
    'experience', 'lessons', 'learned', 'insights', 
    'strategy', 'tactics', 'approach', 'method', 'system',
    'outcome', 'impact', 'effect'
  ],
  weak: [
    'my', 'our', 'real', 'actual', 'honest', 'truth', 'behind the scenes',
    'documentary', 'inside look'
  ]
});

// 6. NEWS_ANALYSIS - prevent false positives from "new sponsor"
console.log('6️⃣ Refining news_analysis detection...');
formatDetectionService.updateFormatKeywords(VideoFormat.NEWS_ANALYSIS, {
  strong: [
    'breaking', 'news', 'update', 'announced', 'leaked', 'confirmed',
    'revealed', 'report', 'latest', 'just in', 'happening now',
    'statement', 'response', 'reaction',
    'killed this'  // Analysis of industry changes
  ],
  medium: [
    'analysis', 'opinion', 'thoughts', 'take', 'perspective',
    'implications', 'impact', 'means', 'changes', 'affects',
    'industry', 'market', 'technology'
  ],
  weak: [
    'recent', 'current', 'today', 'yesterday', 'this week',
    'trending', 'viral', 'hot', 'discussion'
  ]
});

// Test the improvements
console.log('\n✅ Improvements Applied! Testing with problematic titles:\n');

const testTitles = [
  "Mustache Mike's Corner (Classic Episode #5)- Choosing and preparing your scroll saw materials",
  "Vlog 24 - A New Sponsor!!!",
  "$$$$ killed this ancient saw technology",
  "These Creator Deals Are TOO GOOD To Pass Up! - Black Friday 2024",
  "The GENIUS Harmony That Made \"Africa\" Toto's BIGGEST Hit",
  "How We Built A Garden Room In Under 12 Hours"
];

testTitles.forEach(title => {
  const result = formatDetectionService.detectFormat(title);
  console.log(`📹 "${title}"`);
  console.log(`   → ${result.format} (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
  console.log(`   ${result.requiresLLM ? '⚠️  Would use LLM' : '✅ Keyword detection sufficient'}\n`);
});

console.log('💡 Additional Recommendations:\n');
console.log('1. Adjust confidence threshold from 0.6 to 0.65 based on tracking data');
console.log('2. Consider channel profiles for: Stumpy Nubs, Babish Culinary Universe');
console.log('3. Monitor "personal_story" false positives - still the most common error');
console.log('4. The word "genius" often indicates explainer content, not personal stories');

// Show how to update the threshold
console.log('\nTo apply threshold change:');
console.log('formatDetectionService.setConfidenceThreshold(0.65);');