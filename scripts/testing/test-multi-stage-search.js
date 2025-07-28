#!/usr/bin/env node

import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables - try both .env.local and .env
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Check for required environment variables
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables!');
  console.error('Please ensure the following are set in .env.local or .env:');
  console.error('- NEXT_PUBLIC_SUPABASE_URL');
  console.error('- SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test cases from the PRD
const TEST_CASES = [
  { 
    query: "laser cutting beginner",
    description: "Sarah's journey from the PRD - finding beginner content in a technical niche"
  },
  { 
    query: "cooking for beginners",
    description: "Different niche to test transferability of patterns"
  },
  { 
    query: "productivity apps",
    description: "Tech niche to test format patterns and competitive analysis"
  }
];

// Track costs
let totalCosts = {
  openai_embeddings: 0,
  openai_llm: 0,
  total_api_calls: 0
};

// Helper to estimate costs
function estimateCosts(type, tokens) {
  const rates = {
    'gpt-4o-mini': 0.00015 / 1000, // $0.15 per 1M tokens
    'text-embedding-3-small': 0.00002 / 1000 // $0.02 per 1M tokens
  };
  
  if (type === 'embedding') {
    totalCosts.openai_embeddings += tokens * rates['text-embedding-3-small'];
  } else if (type === 'llm') {
    totalCosts.openai_llm += tokens * rates['gpt-4o-mini'];
  }
  totalCosts.total_api_calls++;
}

async function runMultiStageSearch(testCase) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 TESTING: ${testCase.query}`);
  console.log(`📝 Description: ${testCase.description}`);
  console.log(`${'='.repeat(80)}\n`);

  const results = {
    query: testCase.query,
    stages: {},
    insights: [],
    actionableRecommendations: [],
    metrics: {
      totalVideosFound: 0,
      uniqueInsights: 0,
      executionTime: 0,
      costs: {}
    }
  };

  const startTime = Date.now();

  try {
    // Stage 1: Direct Database Search (Keyword + Semantic)
    console.log('\n📍 STAGE 1: Direct Database Search');
    console.log('─'.repeat(50));
    
    const stage1Response = await fetch('http://localhost:3000/api/youtube/intelligent-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: testCase.query,
        page: 1,
        limit: 20,
        fastMode: false // Full AI mode for comprehensive results
      })
    });

    const stage1Data = await stage1Response.json();
    
    // Estimate embedding cost (1 query embedding)
    estimateCosts('embedding', testCase.query.split(' ').length * 1.3);
    // Estimate LLM cost for research expansion
    estimateCosts('llm', 800); // ~800 tokens for expansion prompt + response

    results.stages.direct = {
      videosFound: stage1Data.results?.length || 0,
      categories: Object.keys(stage1Data.grouped_results || {}).length,
      strategies: stage1Data.strategies_used || [],
      topVideos: (stage1Data.results || []).slice(0, 5).map(v => ({
        title: v.title,
        views: v.view_count,
        performance: v.performance_ratio,
        format: v.format_type
      }))
    };

    console.log(`✅ Found ${results.stages.direct.videosFound} videos across ${results.stages.direct.categories} categories`);
    console.log(`📊 Strategies used:`, results.stages.direct.strategies.map(s => `${s.strategy} (${s.results_count} results)`).join(', '));

    // Stage 2: Format Analysis in the Niche
    console.log('\n\n📍 STAGE 2: Format Analysis in the Niche');
    console.log('─'.repeat(50));

    // First, find the dominant topic in our results
    const topicCounts = {};
    for (const video of (stage1Data.results || [])) {
      // Get topic information from the database
      const { data: videoData } = await supabase
        .from('videos')
        .select('topic_level_3, topic_level_2')
        .eq('id', video.id)
        .single();
      
      if (videoData?.topic_level_3) {
        topicCounts[videoData.topic_level_3] = (topicCounts[videoData.topic_level_3] || 0) + 1;
      }
    }

    const dominantTopic = Object.entries(topicCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0];

    if (dominantTopic) {
      const patternResponse = await fetch(`http://localhost:3000/api/youtube/patterns/${dominantTopic}`);
      const patternData = await patternResponse.json();

      results.stages.formatAnalysis = {
        dominantTopic,
        topFormats: patternData.topFormats || [],
        emergingFormats: patternData.emergingFormats || [],
        saturationWarnings: patternData.saturationWarnings || [],
        summary: patternData.summary || {}
      };

      console.log(`🎯 Dominant topic: ${dominantTopic}`);
      console.log(`📊 Top performing formats:`);
      (patternData.topFormats || []).forEach(f => {
        console.log(`   - ${f.format}: ${f.avgPerformance.toFixed(2)}x avg performance (${f.videoCount} videos)`);
      });
      
      if (patternData.emergingFormats?.length > 0) {
        console.log(`🚀 Emerging formats:`);
        patternData.emergingFormats.forEach(f => {
          console.log(`   - ${f.format}: ${f.trend > 0 ? '+' : ''}${f.trend.toFixed(0)}% growth`);
        });
      }

      // Extract insights
      if (patternData.topFormats?.length > 0) {
        const topFormat = patternData.topFormats[0];
        results.insights.push(
          `${topFormat.format} format performs ${topFormat.avgPerformance.toFixed(1)}x better than average in this niche`
        );
      }
    }

    // Stage 3: Cross-Niche Opportunity Discovery
    console.log('\n\n📍 STAGE 3: Cross-Niche Opportunity Discovery');
    console.log('─'.repeat(50));

    if (dominantTopic) {
      const patternData = results.stages.formatAnalysis;
      
      if (patternData.crossNicheOpportunities?.length > 0) {
        results.stages.crossNiche = {
          opportunities: patternData.crossNicheOpportunities,
          count: patternData.crossNicheOpportunities.length
        };

        console.log(`🌟 Found ${patternData.crossNicheOpportunities.length} cross-niche opportunities:`);
        patternData.crossNicheOpportunities.forEach(opp => {
          console.log(`   - ${opp.format} format: ${opp.performance.toFixed(2)}x performance in adjacent topics`);
          console.log(`     Current adoption: ${(opp.adoptionRate * 100).toFixed(1)}% (opportunity!)`);
        });

        // Add insight
        const topOpp = patternData.crossNicheOpportunities[0];
        if (topOpp) {
          results.insights.push(
            `${topOpp.format} format is underutilized (${(topOpp.adoptionRate * 100).toFixed(0)}% adoption) but performs ${topOpp.performance.toFixed(1)}x in related topics`
          );
        }
      }
    }

    // Stage 4: LLM Insight Generation
    console.log('\n\n📍 STAGE 4: LLM Insight Generation');
    console.log('─'.repeat(50));

    // Analyze patterns to generate actionable recommendations
    const insights = [];
    
    // Pattern 1: Format effectiveness
    if (results.stages.formatAnalysis?.topFormats?.length > 0) {
      const topFormats = results.stages.formatAnalysis.topFormats.slice(0, 3);
      insights.push({
        type: 'format_recommendation',
        insight: `For "${testCase.query}", prioritize ${topFormats.map(f => f.format).join(', ')} formats`,
        data: topFormats
      });
    }

    // Pattern 2: Saturation warnings
    if (results.stages.formatAnalysis?.saturationWarnings?.length > 0) {
      insights.push({
        type: 'saturation_warning',
        insight: results.stages.formatAnalysis.saturationWarnings[0],
        recommendation: 'Avoid oversaturated formats or find unique angles'
      });
    }

    // Pattern 3: Emerging opportunities
    if (results.stages.formatAnalysis?.emergingFormats?.length > 0) {
      const emerging = results.stages.formatAnalysis.emergingFormats[0];
      insights.push({
        type: 'emerging_opportunity',
        insight: `${emerging.format} format is trending up ${emerging.trend.toFixed(0)}% - early mover advantage`,
        data: emerging
      });
    }

    // Pattern 4: Cross-niche opportunities
    if (results.stages.crossNiche?.opportunities?.length > 0) {
      const opp = results.stages.crossNiche.opportunities[0];
      insights.push({
        type: 'cross_niche',
        insight: `Import "${opp.format}" format from adjacent niches for ${opp.performance.toFixed(1)}x potential`,
        data: opp
      });
    }

    results.stages.llmInsights = insights;

    // Generate actionable recommendations like the PRD example
    const actionablePatterns = [];

    // Look for list/tier patterns
    const listVideos = (stage1Data.results || []).filter(v => 
      v.format_type === 'listicle' || 
      v.title.toLowerCase().includes('top') || 
      v.title.toLowerCase().includes('best')
    );
    
    if (listVideos.length > 3) {
      // Analyze list sizes
      const listSizes = listVideos.map(v => {
        const match = v.title.match(/(\d+)/);
        return match ? parseInt(match[1]) : null;
      }).filter(Boolean);
      
      if (listSizes.length > 0) {
        const avgSize = listSizes.reduce((a, b) => a + b, 0) / listSizes.length;
        actionablePatterns.push(
          `Tier lists/rankings work best with ${Math.round(avgSize)} items (based on ${listSizes.length} successful videos)`
        );
      }
    }

    // Look for beginner content patterns
    if (testCase.query.includes('beginner')) {
      const beginnerVideos = (stage1Data.results || []).filter(v => 
        v.title.toLowerCase().includes('beginner') ||
        v.title.toLowerCase().includes('start') ||
        v.title.toLowerCase().includes('first')
      );
      
      if (beginnerVideos.length > 0) {
        const avgPerformance = beginnerVideos.reduce((sum, v) => sum + v.performance_ratio, 0) / beginnerVideos.length;
        if (avgPerformance > 1.5) {
          actionablePatterns.push(
            `Beginner-focused content performs ${avgPerformance.toFixed(1)}x better than average - clear opportunity`
          );
        }
      }
    }

    // Look for comparison patterns
    const comparisonVideos = (stage1Data.results || []).filter(v => 
      v.format_type === 'comparison' || 
      v.title.toLowerCase().includes(' vs ')
    );
    
    if (comparisonVideos.length > 2) {
      actionablePatterns.push(
        `Comparison videos are popular (${comparisonVideos.length} found) - consider head-to-head format`
      );
    }

    results.actionableRecommendations = actionablePatterns;

    console.log(`💡 Generated ${insights.length} insights`);
    insights.forEach(insight => {
      console.log(`   - [${insight.type}] ${insight.insight}`);
    });

    console.log(`\n🎯 Actionable Recommendations:`);
    actionablePatterns.forEach(pattern => {
      console.log(`   ✓ ${pattern}`);
    });

  } catch (error) {
    console.error('❌ Error during search:', error);
    results.error = error.message;
  }

  // Calculate final metrics
  results.metrics.executionTime = Date.now() - startTime;
  results.metrics.totalVideosFound = results.stages.direct?.videosFound || 0;
  results.metrics.uniqueInsights = results.insights.length + results.actionableRecommendations.length;
  results.metrics.costs = {
    embeddings: totalCosts.openai_embeddings,
    llm: totalCosts.openai_llm,
    total: totalCosts.openai_embeddings + totalCosts.openai_llm,
    apiCalls: totalCosts.total_api_calls
  };

  return results;
}

async function main() {
  console.log('🚀 Multi-Stage Search Strategy Test');
  console.log('=' .repeat(80));
  console.log('Testing comprehensive search pipeline with 3 test cases\n');

  const allResults = [];

  for (const testCase of TEST_CASES) {
    const result = await runMultiStageSearch(testCase);
    allResults.push(result);
    
    // Add delay between searches to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Summary Report
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 SUMMARY REPORT');
  console.log('='.repeat(80));

  allResults.forEach(result => {
    console.log(`\n🔍 Query: "${result.query}"`);
    console.log(`   - Execution time: ${(result.metrics.executionTime / 1000).toFixed(2)}s`);
    console.log(`   - Total videos found: ${result.metrics.totalVideosFound}`);
    console.log(`   - Unique insights: ${result.metrics.uniqueInsights}`);
    console.log(`   - Estimated cost: $${result.metrics.costs.total.toFixed(4)}`);
    
    if (result.actionableRecommendations.length > 0) {
      console.log(`   - Key recommendations:`);
      result.actionableRecommendations.forEach(rec => {
        console.log(`     • ${rec}`);
      });
    }
  });

  // Total costs
  const totalCost = allResults.reduce((sum, r) => sum + r.metrics.costs.total, 0);
  const totalVideos = allResults.reduce((sum, r) => sum + r.metrics.totalVideosFound, 0);
  const totalInsights = allResults.reduce((sum, r) => sum + r.metrics.uniqueInsights, 0);

  console.log('\n📈 AGGREGATE METRICS:');
  console.log(`   - Total videos analyzed: ${totalVideos}`);
  console.log(`   - Total insights generated: ${totalInsights}`);
  console.log(`   - Total estimated cost: $${totalCost.toFixed(4)}`);
  console.log(`   - Cost per insight: $${(totalCost / totalInsights).toFixed(4)}`);
  console.log(`   - Average execution time: ${(allResults.reduce((sum, r) => sum + r.metrics.executionTime, 0) / allResults.length / 1000).toFixed(2)}s`);
}

// Run the test
main().catch(console.error);