#!/usr/bin/env node

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Import services
const { formatDetectionService, VideoFormat } = require('../lib/format-detection-service');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Sample videos for testing
const testVideos = [
  // Tutorials
  { id: '1', title: 'How to Build a React App - Complete Tutorial for Beginners', channel: 'CodeAcademy' },
  { id: '2', title: 'Learn Python in 10 Minutes - Quick Start Guide', channel: 'PythonPro' },
  
  // Listicles
  { id: '3', title: 'Top 10 JavaScript Frameworks in 2024', channel: 'WebDevNews' },
  { id: '4', title: '5 Mistakes Every Developer Makes', channel: 'DevTips' },
  
  // Explainers
  { id: '5', title: 'What is Machine Learning? Explained Simply', channel: 'AIBasics' },
  { id: '6', title: 'Understanding Blockchain Technology - The Basics', channel: 'CryptoEdu' },
  
  // Case Studies
  { id: '7', title: 'How I Built a $1M SaaS in 12 Months', channel: 'StartupStories' },
  { id: '8', title: 'Our Journey from 0 to 100K Subscribers', channel: 'CreatorInsights' },
  
  // News Analysis
  { id: '9', title: 'Breaking: OpenAI Announces GPT-5 - My Analysis', channel: 'TechNews' },
  { id: '10', title: 'Apple Event Reaction - Everything Announced Today', channel: 'AppleInsider' },
  
  // Personal Stories
  { id: '11', title: 'My Burnout Story - Why I Quit Tech', channel: 'DevLife' },
  { id: '12', title: 'Opening Up About My Mental Health Journey', channel: 'RealTalk' },
  
  // Product Focus
  { id: '13', title: 'MacBook Pro M3 Review - Worth the Upgrade?', channel: 'TechReviews' },
  { id: '14', title: 'Unboxing the New iPhone 15 Pro Max', channel: 'PhoneGeek' },
  
  // Edge cases
  { id: '15', title: 'Best Tips and Tricks', channel: 'GeneralAdvice' }, // Ambiguous
  { id: '16', title: 'My Latest Video', channel: 'RandomChannel' }, // Very vague
  { id: '17', title: 'How to Top 10 Things You Need to Know About React Tutorial', channel: 'ConfusedDev' }, // Multiple signals
];

async function testFormatDetection() {
  console.log('🧪 Testing Video Format Detection\n');
  console.log('='.repeat(80));
  
  const results = [];
  
  for (const video of testVideos) {
    const detection = formatDetectionService.detectFormat(video.title, video.channel);
    results.push({ video, detection });
    
    console.log(`\n📹 ${video.title}`);
    console.log(`   Channel: ${video.channel}`);
    console.log(`   ➜ Format: ${detection.format.toUpperCase()} (${(detection.confidence * 100).toFixed(0)}% confidence)`);
    
    if (detection.requiresLLM) {
      console.log(`   ⚠️  Low confidence - LLM verification recommended`);
    }
    
    // Show top matches
    console.log(`   📊 Scores:`);
    detection.scores.slice(0, 3).forEach(score => {
      const keywords = [...score.matchedKeywords.strong, ...score.matchedKeywords.medium];
      console.log(`      - ${score.format}: ${score.score} pts (${keywords.join(', ')})`);
    });
  }
  
  // Summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Summary Statistics:');
  
  const formatCounts = {};
  const confidenceByFormat = {};
  let llmNeeded = 0;
  
  results.forEach(({ detection }) => {
    formatCounts[detection.format] = (formatCounts[detection.format] || 0) + 1;
    if (!confidenceByFormat[detection.format]) {
      confidenceByFormat[detection.format] = [];
    }
    confidenceByFormat[detection.format].push(detection.confidence);
    if (detection.requiresLLM) llmNeeded++;
  });
  
  console.log(`\nFormat Distribution:`);
  Object.entries(formatCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([format, count]) => {
      const avgConfidence = (confidenceByFormat[format].reduce((a, b) => a + b, 0) / count * 100).toFixed(0);
      console.log(`  - ${format}: ${count} videos (avg confidence: ${avgConfidence}%)`);
    });
  
  console.log(`\nLLM Verification Needed: ${llmNeeded}/${testVideos.length} (${(llmNeeded/testVideos.length*100).toFixed(0)}%)`);
  
  // Test database query for existing videos
  console.log('\n' + '='.repeat(80));
  console.log('\n🔍 Testing on Real Database Videos...\n');
  
  const { data: dbVideos, error } = await supabase
    .from('videos')
    .select('id, title, channel_name')
    .order('view_count', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('❌ Database error:', error);
    return;
  }
  
  if (dbVideos && dbVideos.length > 0) {
    console.log(`Found ${dbVideos.length} videos in database:\n`);
    
    for (const video of dbVideos) {
      const detection = formatDetectionService.detectFormat(video.title, video.channel_name);
      console.log(`📹 ${video.title.substring(0, 60)}...`);
      console.log(`   ➜ Format: ${detection.format.toUpperCase()} (${(detection.confidence * 100).toFixed(0)}%)`);
    }
  }
  
  // Configuration test
  console.log('\n' + '='.repeat(80));
  console.log('\n⚙️  Current Configuration:');
  const config = formatDetectionService.getConfiguration();
  console.log(JSON.stringify(config, null, 2));
}

// Run the test
testFormatDetection().catch(console.error);