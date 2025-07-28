#!/usr/bin/env node

// Simple test to demonstrate multi-stage search strategy using direct database queries

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Check for required environment variables
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables!');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Test cases
const TEST_CASES = [
  "laser cutting beginner",
  "cooking for beginners", 
  "productivity apps"
];

async function testSearchStages(query) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 TESTING: "${query}"`);
  console.log(`${'='.repeat(80)}\n`);

  const results = {
    query,
    stages: {},
    insights: [],
    metrics: {}
  };

  try {
    // Stage 1: Direct keyword search
    console.log('📍 STAGE 1: Direct Database Search (Keyword)');
    console.log('─'.repeat(50));
    
    const searchTerms = query.toLowerCase().split(' ');
    let keywordQuery = supabase
      .from('videos')
      .select('id, title, channel_name, view_count, format_type, published_at')
      .limit(20);
    
    // Build OR query for each search term
    const orConditions = searchTerms.map(term => `title.ilike.%${term}%`).join(',');
    keywordQuery = keywordQuery.or(orConditions);
    
    const { data: keywordResults, error: keywordError } = await keywordQuery;
    
    if (keywordError) {
      console.error('Keyword search error:', keywordError);
    } else {
      results.stages.keyword = {
        count: keywordResults?.length || 0,
        samples: keywordResults?.slice(0, 3).map(v => ({
          title: v.title,
          views: v.view_count,
          format: v.format_type
        }))
      };
      console.log(`✅ Found ${keywordResults?.length || 0} videos with keyword matches`);
    }

    // Stage 2: Format analysis
    console.log('\n📍 STAGE 2: Format Analysis');
    console.log('─'.repeat(50));
    
    if (keywordResults && keywordResults.length > 0) {
      // Count format types
      const formatCounts = {};
      keywordResults.forEach(video => {
        const format = video.format_type || 'unknown';
        formatCounts[format] = (formatCounts[format] || 0) + 1;
      });
      
      const topFormats = Object.entries(formatCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3);
      
      results.stages.formatAnalysis = {
        topFormats: topFormats.map(([format, count]) => ({ format, count })),
        totalFormats: Object.keys(formatCounts).length
      };
      
      console.log('📊 Top formats:');
      topFormats.forEach(([format, count]) => {
        console.log(`   - ${format}: ${count} videos (${((count/keywordResults.length)*100).toFixed(0)}%)`);
      });
      
      // Add insight
      if (topFormats.length > 0 && topFormats[0][1] > keywordResults.length * 0.3) {
        results.insights.push(
          `${topFormats[0][0]} format dominates with ${((topFormats[0][1]/keywordResults.length)*100).toFixed(0)}% of results`
        );
      }
    }

    // Stage 3: Performance analysis
    console.log('\n📍 STAGE 3: Performance Patterns');
    console.log('─'.repeat(50));
    
    // Get high-performing videos in this search
    const { data: topPerformers } = await supabase
      .from('videos')
      .select('id, title, view_count, format_type, channel_avg_views')
      .or(orConditions)
      .order('view_count', { ascending: false })
      .limit(10);
    
    if (topPerformers && topPerformers.length > 0) {
      // Calculate performance ratios
      const performanceData = topPerformers.map(video => {
        const baseline = video.channel_avg_views || video.view_count;
        const ratio = baseline > 0 ? video.view_count / baseline : 1;
        return { ...video, performance_ratio: ratio };
      });
      
      // Find patterns in high performers
      const highPerformers = performanceData.filter(v => v.performance_ratio > 2);
      
      results.stages.performance = {
        topPerformersCount: topPerformers.length,
        highPerformersCount: highPerformers.length,
        avgPerformanceRatio: performanceData.reduce((sum, v) => sum + v.performance_ratio, 0) / performanceData.length
      };
      
      console.log(`⚡ ${highPerformers.length} videos perform 2x+ above baseline`);
      console.log(`📈 Average performance ratio: ${results.stages.performance.avgPerformanceRatio.toFixed(2)}x`);
      
      // Look for title patterns in high performers
      const titleWords = {};
      highPerformers.forEach(video => {
        video.title.toLowerCase().split(/\s+/).forEach(word => {
          if (word.length > 3 && !['with', 'from', 'that', 'this', 'what', 'when', 'where', 'which'].includes(word)) {
            titleWords[word] = (titleWords[word] || 0) + 1;
          }
        });
      });
      
      const commonWords = Object.entries(titleWords)
        .filter(([,count]) => count > 1)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5);
      
      if (commonWords.length > 0) {
        console.log('🔤 Common words in high-performing titles:');
        commonWords.forEach(([word, count]) => {
          console.log(`   - "${word}" appears in ${count} titles`);
        });
        
        results.insights.push(
          `High-performing videos often include: ${commonWords.slice(0, 3).map(([w]) => `"${w}"`).join(', ')}`
        );
      }
    }

    // Stage 4: Cross-niche opportunities
    console.log('\n📍 STAGE 4: Cross-Niche Discovery');
    console.log('─'.repeat(50));
    
    // Find related topics by looking at channels that cover our search topic
    const { data: channelVideos } = await supabase
      .from('videos')
      .select('channel_id, channel_name')
      .or(orConditions)
      .limit(50);
    
    if (channelVideos && channelVideos.length > 0) {
      // Get unique channels
      const channels = [...new Set(channelVideos.map(v => v.channel_id))].filter(Boolean);
      
      // Sample other content from these channels
      const { data: crossContent } = await supabase
        .from('videos')
        .select('title, format_type, view_count')
        .in('channel_id', channels.slice(0, 5))
        .not('title', 'ilike', `%${searchTerms[0]}%`)
        .order('view_count', { ascending: false })
        .limit(20);
      
      if (crossContent && crossContent.length > 0) {
        // Find different formats used by these channels
        const crossFormats = {};
        crossContent.forEach(video => {
          const format = video.format_type || 'unknown';
          crossFormats[format] = (crossFormats[format] || 0) + 1;
        });
        
        results.stages.crossNiche = {
          channelsAnalyzed: channels.length,
          crossContentFound: crossContent.length,
          uniqueFormats: Object.keys(crossFormats).length
        };
        
        console.log(`🌐 Analyzed ${channels.length} related channels`);
        console.log(`📚 Found ${crossContent.length} videos in adjacent topics`);
        console.log(`🎨 Discovered ${Object.keys(crossFormats).length} different format types`);
        
        // Find formats not used in our main search but popular in related content
        const mainFormats = results.stages.formatAnalysis?.topFormats?.map(f => f.format) || [];
        const newFormats = Object.entries(crossFormats)
          .filter(([format]) => !mainFormats.includes(format))
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3);
        
        if (newFormats.length > 0) {
          console.log('💡 Format opportunities from adjacent niches:');
          newFormats.forEach(([format, count]) => {
            console.log(`   - ${format} format (${count} successful examples)`);
          });
          
          results.insights.push(
            `Consider ${newFormats[0][0]} format - successful in related content but underused for "${query}"`
          );
        }
      }
    }

    // Generate actionable recommendations
    console.log('\n🎯 ACTIONABLE RECOMMENDATIONS:');
    console.log('─'.repeat(50));
    
    const recommendations = [];
    
    // Recommendation 1: Format strategy
    if (results.stages.formatAnalysis?.topFormats?.length > 0) {
      const topFormat = results.stages.formatAnalysis.topFormats[0];
      if (topFormat.count > 5) {
        recommendations.push(
          `Use ${topFormat.format} format - proven successful with ${topFormat.count} examples`
        );
      }
    }
    
    // Recommendation 2: Title optimization
    if (results.insights.some(i => i.includes('High-performing videos'))) {
      const titleInsight = results.insights.find(i => i.includes('High-performing videos'));
      recommendations.push(titleInsight.replace('High-performing videos often include:', 'Include in title:'));
    }
    
    // Recommendation 3: Cross-niche opportunity
    if (results.stages.crossNiche?.uniqueFormats > 3) {
      recommendations.push(
        `Explore ${results.stages.crossNiche.uniqueFormats} different format types from adjacent niches`
      );
    }
    
    recommendations.forEach(rec => {
      console.log(`   ✓ ${rec}`);
    });
    
    results.recommendations = recommendations;

    // Calculate metrics
    results.metrics = {
      totalVideosAnalyzed: (results.stages.keyword?.count || 0) + 
                          (results.stages.performance?.topPerformersCount || 0) + 
                          (results.stages.crossNiche?.crossContentFound || 0),
      insightsGenerated: results.insights.length,
      recommendationsGenerated: recommendations.length
    };

  } catch (error) {
    console.error('❌ Error during analysis:', error);
    results.error = error.message;
  }

  return results;
}

async function main() {
  console.log('🚀 Multi-Stage Search Strategy Test');
  console.log('Testing search pipeline with direct database queries\n');

  const allResults = [];

  for (const testCase of TEST_CASES) {
    const result = await testSearchStages(testCase);
    allResults.push(result);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 SUMMARY REPORT');
  console.log('='.repeat(80));

  allResults.forEach(result => {
    console.log(`\n🔍 "${result.query}"`);
    console.log(`   - Videos analyzed: ${result.metrics.totalVideosAnalyzed}`);
    console.log(`   - Insights generated: ${result.metrics.insightsGenerated}`);
    console.log(`   - Recommendations: ${result.metrics.recommendationsGenerated}`);
  });

  const totalVideos = allResults.reduce((sum, r) => sum + r.metrics.totalVideosAnalyzed, 0);
  const totalInsights = allResults.reduce((sum, r) => sum + r.metrics.insightsGenerated + r.metrics.recommendationsGenerated, 0);

  console.log('\n📈 TOTAL:');
  console.log(`   - Videos analyzed: ${totalVideos}`);
  console.log(`   - Actionable insights: ${totalInsights}`);
}

main().catch(console.error);