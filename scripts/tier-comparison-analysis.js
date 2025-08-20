#!/usr/bin/env node
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function analyzeTierComparison() {
  console.log('📊 Analyzing patterns by performance tier...\n');
  
  try {
    // Load the full dataset
    const dataPath = path.join(path.dirname(__dirname), 'exports', 'outliers-may-june-2025-2025-08-16.json');
    const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
    const videos = data.videos;
    
    // Group videos by performance tier
    const tiers = {
      '50-100x': videos.filter(v => parseFloat(v.performance_score) >= 50),
      '20-50x': videos.filter(v => parseFloat(v.performance_score) >= 20 && parseFloat(v.performance_score) < 50),
      '10-20x': videos.filter(v => parseFloat(v.performance_score) >= 10 && parseFloat(v.performance_score) < 20),
      '5-10x': videos.filter(v => parseFloat(v.performance_score) >= 5 && parseFloat(v.performance_score) < 10),
      '3-5x': videos.filter(v => parseFloat(v.performance_score) >= 3 && parseFloat(v.performance_score) < 5)
    };

    console.log('🎯 Performance Tier Breakdown:');
    console.log('===============================');
    Object.entries(tiers).forEach(([tier, vids]) => {
      console.log(`${tier.padEnd(8)}: ${vids.length} videos`);
    });

    // Analyze characteristics by tier
    const tierAnalysis = {};
    
    Object.entries(tiers).forEach(([tier, vids]) => {
      if (vids.length === 0) return;
      
      // Format distribution
      const formats = {};
      vids.forEach(v => {
        formats[v.format_type] = (formats[v.format_type] || 0) + 1;
      });
      
      // Niche distribution
      const niches = {};
      vids.forEach(v => {
        niches[v.topic_niche] = (niches[v.topic_niche] || 0) + 1;
      });
      
      // Top formats and niches
      const topFormats = Object.entries(formats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      const topNiches = Object.entries(niches)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      
      // Average statistics
      const avgViews = Math.round(vids.reduce((sum, v) => sum + v.view_count, 0) / vids.length);
      const avgScore = (vids.reduce((sum, v) => sum + parseFloat(v.performance_score), 0) / vids.length).toFixed(1);
      
      tierAnalysis[tier] = {
        count: vids.length,
        avg_views: avgViews,
        avg_score: parseFloat(avgScore),
        top_formats: topFormats,
        top_niches: topNiches,
        unique_channels: new Set(vids.map(v => v.channel_id)).size,
        sample_titles: vids
          .sort((a, b) => parseFloat(b.performance_score) - parseFloat(a.performance_score))
          .slice(0, 3)
          .map(v => ({ title: v.title, score: v.performance_score }))
      };
    });

    // Display tier analysis
    console.log('\n🔍 Tier-by-Tier Analysis:');
    console.log('===========================');
    
    Object.entries(tierAnalysis).forEach(([tier, analysis]) => {
      console.log(`\n📈 ${tier} Tier (${analysis.count} videos)`);
      console.log(`   Avg Performance: ${analysis.avg_score}x`);
      console.log(`   Avg Views: ${analysis.avg_views.toLocaleString()}`);
      console.log(`   Unique Channels: ${analysis.unique_channels}`);
      
      console.log(`   Top Formats:`);
      analysis.top_formats.forEach(([format, count]) => {
        const pct = ((count / analysis.count) * 100).toFixed(1);
        console.log(`     ${format}: ${count} (${pct}%)`);
      });
      
      console.log(`   Top Niches:`);
      analysis.top_niches.forEach(([niche, count]) => {
        const pct = ((count / analysis.count) * 100).toFixed(1);
        console.log(`     ${niche}: ${count} (${pct}%)`);
      });
      
      console.log(`   Sample Top Performers:`);
      analysis.sample_titles.forEach(({ title, score }) => {
        console.log(`     ${score}x: ${title.substring(0, 60)}${title.length > 60 ? '...' : ''}`);
      });
    });

    // Identify tier-specific patterns
    console.log('\n🎯 Key Tier Insights:');
    console.log('======================');
    
    // Find formats that become more/less common in higher tiers
    const formatProgression = analyzeFormatProgression(tierAnalysis);
    console.log('\n📊 Format Trends by Performance Tier:');
    formatProgression.forEach(trend => {
      console.log(`   ${trend.format}: ${trend.trend} (${trend.low_tier}% → ${trend.high_tier}%)`);
    });
    
    // Find niches that dominate higher tiers
    const nicheProgression = analyzeNicheProgression(tierAnalysis);
    console.log('\n🏆 Niches That Excel in Higher Tiers:');
    nicheProgression.slice(0, 8).forEach(trend => {
      console.log(`   ${trend.niche}: ${trend.high_tier_pct}% in top tiers vs ${trend.low_tier_pct}% overall`);
    });

    // Save analysis
    const timestamp = new Date().toISOString().split('T')[0];
    const analysisPath = path.join(path.dirname(__dirname), 'exports', `tier-comparison-analysis-${timestamp}.json`);
    
    await fs.writeFile(analysisPath, JSON.stringify({
      metadata: {
        total_videos: videos.length,
        analysis_date: new Date().toISOString(),
        tiers_analyzed: Object.keys(tiers).length
      },
      tier_analysis: tierAnalysis,
      format_progression: formatProgression,
      niche_progression: nicheProgression
    }, null, 2));
    
    console.log(`\n✅ Tier comparison analysis saved to: ${path.basename(analysisPath)}`);

  } catch (error) {
    console.error('❌ Error analyzing tier comparison:', error);
    process.exit(1);
  }
}

function analyzeFormatProgression(tierAnalysis) {
  const tiers = ['3-5x', '5-10x', '10-20x', '20-50x', '50-100x'];
  const allFormats = new Set();
  
  // Collect all formats
  Object.values(tierAnalysis).forEach(tier => {
    tier.top_formats.forEach(([format]) => allFormats.add(format));
  });
  
  const progression = [];
  
  allFormats.forEach(format => {
    const percentages = tiers.map(tier => {
      if (!tierAnalysis[tier]) return 0;
      const formatCount = tierAnalysis[tier].top_formats.find(([f]) => f === format)?.[1] || 0;
      return (formatCount / tierAnalysis[tier].count) * 100;
    });
    
    const lowTier = (percentages[0] + percentages[1]) / 2; // Average of 3-5x and 5-10x
    const highTier = (percentages[3] + percentages[4]) / 2; // Average of 20-50x and 50-100x
    
    if (highTier > 0 || lowTier > 0) {
      const trend = highTier > lowTier + 5 ? 'increases' : 
                   lowTier > highTier + 5 ? 'decreases' : 'stable';
      
      progression.push({
        format,
        trend,
        low_tier: lowTier.toFixed(1),
        high_tier: highTier.toFixed(1),
        difference: (highTier - lowTier).toFixed(1)
      });
    }
  });
  
  return progression.sort((a, b) => Math.abs(parseFloat(b.difference)) - Math.abs(parseFloat(a.difference)));
}

function analyzeNicheProgression(tierAnalysis) {
  const allNiches = new Set();
  
  // Collect all niches
  Object.values(tierAnalysis).forEach(tier => {
    tier.top_niches.forEach(([niche]) => allNiches.add(niche));
  });
  
  const progression = [];
  
  allNiches.forEach(niche => {
    // Calculate percentage in high-performance tiers (10x+)
    const highTierVideos = (tierAnalysis['10-20x']?.top_niches.find(([n]) => n === niche)?.[1] || 0) +
                          (tierAnalysis['20-50x']?.top_niches.find(([n]) => n === niche)?.[1] || 0) +
                          (tierAnalysis['50-100x']?.top_niches.find(([n]) => n === niche)?.[1] || 0);
    
    const highTierTotal = (tierAnalysis['10-20x']?.count || 0) +
                         (tierAnalysis['20-50x']?.count || 0) +
                         (tierAnalysis['50-100x']?.count || 0);
    
    // Calculate overall percentage
    const totalVideos = Object.values(tierAnalysis).reduce((sum, tier) => {
      return sum + (tier.top_niches.find(([n]) => n === niche)?.[1] || 0);
    }, 0);
    
    const totalCount = Object.values(tierAnalysis).reduce((sum, tier) => sum + tier.count, 0);
    
    if (highTierVideos > 0 && totalVideos > 0) {
      const highTierPct = (highTierVideos / highTierTotal) * 100;
      const overallPct = (totalVideos / totalCount) * 100;
      
      progression.push({
        niche,
        high_tier_pct: highTierPct.toFixed(1),
        low_tier_pct: overallPct.toFixed(1),
        high_tier_videos: highTierVideos,
        total_videos: totalVideos,
        performance_ratio: highTierPct / overallPct
      });
    }
  });
  
  return progression.sort((a, b) => b.performance_ratio - a.performance_ratio);
}

// Run the analysis
analyzeTierComparison();