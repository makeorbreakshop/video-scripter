#!/usr/bin/env node

// Test the intelligent search API endpoint directly to demonstrate multi-stage search

import fetch from 'node-fetch';

const TEST_CASES = [
  { 
    query: "laser cutting beginner",
    description: "Sarah's journey - technical beginner content"
  },
  { 
    query: "cooking for beginners",
    description: "Different niche to test pattern transferability"
  },
  { 
    query: "productivity apps",
    description: "Tech niche for format patterns"
  }
];

async function testIntelligentSearch(testCase) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 TESTING: "${testCase.query}"`);
  console.log(`📝 ${testCase.description}`);
  console.log(`${'='.repeat(80)}\n`);

  try {
    // Test fast mode first (immediate results)
    console.log('⚡ FAST MODE - Immediate Results');
    console.log('─'.repeat(50));
    
    const fastResponse = await fetch('http://localhost:3000/api/youtube/intelligent-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: testCase.query,
        page: 1,
        limit: 20,
        fastMode: true
      })
    });

    if (!fastResponse.ok) {
      throw new Error(`Fast mode failed: ${fastResponse.status} ${fastResponse.statusText}`);
    }

    const fastData = await fastResponse.json();
    
    console.log(`✅ Fast Results:`);
    console.log(`   - Total videos: ${fastData.results?.length || 0}`);
    console.log(`   - Categories: ${Object.keys(fastData.grouped_results || {}).length}`);
    
    if (fastData.strategies_used) {
      console.log(`   - Strategies: ${fastData.strategies_used.map(s => `${s.strategy} (${s.results_count})`).join(', ')}`);
    }

    // Show category breakdown
    if (fastData.grouped_results) {
      console.log('\n📂 Categories Found:');
      Object.entries(fastData.grouped_results).forEach(([key, data]) => {
        console.log(`   ${data.emoji} ${data.category_name}: ${data.videos.length} videos`);
      });
    }

    // Now test full AI mode
    console.log('\n\n🧠 FULL AI MODE - Enhanced Results');
    console.log('─'.repeat(50));
    
    const aiResponse = await fetch('http://localhost:3000/api/youtube/intelligent-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: testCase.query,
        page: 1,
        limit: 30,
        fastMode: false
      })
    });

    if (!aiResponse.ok) {
      throw new Error(`AI mode failed: ${aiResponse.status} ${aiResponse.statusText}`);
    }

    const aiData = await aiResponse.json();
    
    console.log(`✅ AI-Enhanced Results:`);
    console.log(`   - Total videos: ${aiData.results?.length || 0}`);
    console.log(`   - Categories: ${Object.keys(aiData.grouped_results || {}).length}`);
    
    // Show expansion data
    if (aiData.expansion) {
      console.log('\n🔍 AI Query Expansion:');
      console.log(`   - Expanded terms: ${aiData.expansion.terms?.join(', ')}`);
      console.log(`   - Content types: ${aiData.expansion.content_types?.join(', ')}`);
      console.log(`   - Research angles: ${aiData.expansion.research_angles?.join(', ')}`);
    }

    // Show all categories with Netflix-style names
    if (aiData.grouped_results) {
      console.log('\n📂 AI-Generated Categories:');
      Object.entries(aiData.grouped_results).forEach(([key, data]) => {
        console.log(`   ${data.emoji} ${data.category_name}: ${data.videos.length} videos`);
      });
    }

    // Show strategy breakdown
    if (aiData.strategies_used) {
      console.log('\n📊 Search Strategies Used:');
      aiData.strategies_used.forEach(s => {
        console.log(`   - ${s.strategy}: "${s.query}" → ${s.results_count} results`);
        console.log(`     ${s.description}`);
      });
    }

    // Extract actionable insights
    console.log('\n💡 ACTIONABLE INSIGHTS:');
    console.log('─'.repeat(50));
    
    // Analyze format distribution
    const formatCounts = {};
    (aiData.results || []).forEach(video => {
      const format = video.format_type || 'unknown';
      formatCounts[format] = (formatCounts[format] || 0) + 1;
    });
    
    const topFormats = Object.entries(formatCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3);
    
    if (topFormats.length > 0) {
      console.log(`   ✓ Top formats: ${topFormats.map(([f, c]) => `${f} (${c})`).join(', ')}`);
    }

    // Look for high-performing videos
    const highPerformers = (aiData.results || [])
      .filter(v => v.performance_ratio > 2)
      .sort((a, b) => b.performance_ratio - a.performance_ratio);
    
    if (highPerformers.length > 0) {
      console.log(`   ✓ ${highPerformers.length} videos perform 2x+ above baseline`);
      console.log(`   ✓ Top performer: "${highPerformers[0].title}" (${highPerformers[0].performance_ratio.toFixed(1)}x)`);
    }

    // Pattern detection for lists
    const listVideos = (aiData.results || []).filter(v => 
      v.format_type === 'listicle' || 
      v.title.match(/\d+/) || 
      v.title.toLowerCase().includes('best')
    );
    
    if (listVideos.length > 3) {
      const listNumbers = listVideos
        .map(v => v.title.match(/(\d+)/))
        .filter(Boolean)
        .map(m => parseInt(m[1]));
      
      if (listNumbers.length > 0) {
        const avgNumber = Math.round(listNumbers.reduce((a, b) => a + b, 0) / listNumbers.length);
        console.log(`   ✓ List videos typically feature ${avgNumber} items`);
      }
    }

    return {
      query: testCase.query,
      fastMode: {
        videos: fastData.results?.length || 0,
        categories: Object.keys(fastData.grouped_results || {}).length
      },
      aiMode: {
        videos: aiData.results?.length || 0,
        categories: Object.keys(aiData.grouped_results || {}).length,
        strategies: aiData.strategies_used?.length || 0
      },
      insights: {
        topFormats,
        highPerformersCount: highPerformers.length,
        expansionTerms: aiData.expansion?.terms?.length || 0
      }
    };

  } catch (error) {
    console.error(`❌ Error testing ${testCase.query}:`, error.message);
    return { query: testCase.query, error: error.message };
  }
}

async function main() {
  console.log('🚀 Intelligent Search API Test');
  console.log('Testing multi-stage search with real API endpoints');
  console.log('\n⚠️  Make sure the development server is running (npm run dev)');
  
  // Check if server is running
  try {
    await fetch('http://localhost:3000');
  } catch (error) {
    console.error('\n❌ Development server is not running!');
    console.error('Please run "npm run dev" first, then run this test again.');
    process.exit(1);
  }

  const results = [];

  for (const testCase of TEST_CASES) {
    const result = await testIntelligentSearch(testCase);
    results.push(result);
    
    // Delay between tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 SUMMARY REPORT');
  console.log('='.repeat(80));

  results.forEach(result => {
    if (result.error) {
      console.log(`\n❌ "${result.query}" - Error: ${result.error}`);
    } else {
      console.log(`\n✅ "${result.query}"`);
      console.log(`   Fast Mode: ${result.fastMode.videos} videos, ${result.fastMode.categories} categories`);
      console.log(`   AI Mode: ${result.aiMode.videos} videos, ${result.aiMode.categories} categories, ${result.aiMode.strategies} strategies`);
      console.log(`   Insights: ${result.insights.topFormats.length} formats, ${result.insights.highPerformersCount} high performers`);
    }
  });

  const successCount = results.filter(r => !r.error).length;
  console.log(`\n📈 Success Rate: ${successCount}/${results.length} tests passed`);
}

main().catch(console.error);