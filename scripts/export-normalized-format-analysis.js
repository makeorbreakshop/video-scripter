#!/usr/bin/env node

/**
 * Export videos with age-normalized performance metrics
 * Groups by topic categories for niche-specific format discovery
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const outputDir = '/Users/brandoncullum/video-scripter/exports/format-analysis';

// Create output directory
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function exportNormalizedVideos() {
  console.log('📊 Exporting videos with normalized performance metrics...\n');

  // First check how many videos have topics
  const { count: topicCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('topic_level_1', 'is', null);
    
  console.log(`📈 Videos with topic assignments: ${topicCount?.toLocaleString()}/57,069`);
  
  if (topicCount < 50000) {
    console.log('⏳ Waiting for more topic assignments to complete...');
    console.log('   Run this script again when batch updates are done.\n');
  }

  // Get videos with calculated daily view rate
  console.log('\n1️⃣ Fetching videos with age-normalized metrics...');
  
  // We'll fetch videos and calculate metrics in JavaScript
  const { data: videos } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      view_count,
      published_at,
      topic_level_1,
      topic_level_2,
      topic_level_3
    `)
    .not('topic_level_1', 'is', null)
    .gt('view_count', 1000) // At least 1K views
    .order('view_count', { ascending: false })
    .limit(10000); // Get a large sample

  console.log(`   Fetched ${videos?.length || 0} videos with topics`);

  // Calculate age-normalized metrics
  const now = new Date();
  const normalizedVideos = videos?.map(v => {
    const publishDate = new Date(v.published_at);
    const ageInDays = Math.max(1, (now - publishDate) / (1000 * 60 * 60 * 24));
    const viewsPerDay = v.view_count / ageInDays;
    
    return {
      ...v,
      age_days: Math.floor(ageInDays),
      views_per_day: Math.round(viewsPerDay),
      // Performance tier based on daily views
      performance_tier: 
        viewsPerDay > 100000 ? 'explosive' :
        viewsPerDay > 10000 ? 'viral' :
        viewsPerDay > 1000 ? 'high' :
        viewsPerDay > 100 ? 'medium' : 'low'
    };
  }) || [];

  // Group by domain (topic_level_1)
  console.log('\n2️⃣ Grouping by domains for pattern analysis...');
  const byDomain = {};
  
  normalizedVideos.forEach(v => {
    const domain = v.topic_level_1;
    if (!byDomain[domain]) {
      byDomain[domain] = [];
    }
    byDomain[domain].push(v);
  });

  // Get domain names from topic_categories
  console.log('\n3️⃣ Fetching domain names...');
  const { data: domainNames } = await supabase
    .from('topic_categories')
    .select('topic_id, name')
    .eq('level', 1);

  const domainMap = {};
  domainNames?.forEach(d => {
    domainMap[d.topic_id] = d.name;
  });

  // Create analysis for each domain
  const domainAnalysis = {};
  
  Object.entries(byDomain).forEach(([domainId, videos]) => {
    const domainName = domainMap[domainId] || `Domain ${domainId}`;
    
    // Sort by normalized performance
    const sorted = videos.sort((a, b) => b.views_per_day - a.views_per_day);
    
    // Get different segments
    const topPerformers = sorted.slice(0, 100);
    const recentHits = sorted
      .filter(v => v.age_days < 30)
      .slice(0, 50);
    const consistent = sorted
      .filter(v => v.age_days > 90 && v.views_per_day > 1000)
      .slice(0, 50);
    
    domainAnalysis[domainName] = {
      total_videos: videos.length,
      top_performers: topPerformers,
      recent_hits: recentHits,
      consistent_performers: consistent,
      performance_distribution: {
        explosive: videos.filter(v => v.performance_tier === 'explosive').length,
        viral: videos.filter(v => v.performance_tier === 'viral').length,
        high: videos.filter(v => v.performance_tier === 'high').length,
        medium: videos.filter(v => v.performance_tier === 'medium').length,
        low: videos.filter(v => v.performance_tier === 'low').length
      }
    };
    
    console.log(`   ${domainName}: ${videos.length} videos`);
  });

  // Save analysis files
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Save full analysis
  const fullAnalysis = {
    metadata: {
      export_date: timestamp,
      total_videos_analyzed: normalizedVideos.length,
      domains_analyzed: Object.keys(domainAnalysis).length,
      videos_with_topics: topicCount
    },
    domain_analysis: domainAnalysis
  };

  const analysisFile = `${outputDir}/normalized-format-analysis-${timestamp}.json`;
  fs.writeFileSync(analysisFile, JSON.stringify(fullAnalysis, null, 2));
  console.log(`\n✅ Saved domain analysis: ${analysisFile}`);

  // Create titles-only file for pattern discovery
  console.log('\n4️⃣ Creating focused title lists by domain...');
  
  Object.entries(domainAnalysis).forEach(([domainName, data]) => {
    const titles = {
      domain: domainName,
      top_performers: data.top_performers.map(v => ({
        title: v.title,
        views_per_day: v.views_per_day,
        age_days: v.age_days,
        total_views: v.view_count
      })),
      recent_hits: data.recent_hits.map(v => ({
        title: v.title,
        views_per_day: v.views_per_day,
        age_days: v.age_days,
        total_views: v.view_count
      }))
    };
    
    const domainFile = `${outputDir}/titles-${domainName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${timestamp}.json`;
    fs.writeFileSync(domainFile, JSON.stringify(titles, null, 2));
  });

  console.log('\n🎯 Export complete!');
  console.log('\nNext steps:');
  console.log('1. Analyze title patterns within each domain');
  console.log('2. Compare what works in Tech vs Lifestyle vs Education');
  console.log('3. Look for format patterns that transcend categories');
  console.log('4. Identify category-specific format opportunities');
}

exportNormalizedVideos().catch(console.error);