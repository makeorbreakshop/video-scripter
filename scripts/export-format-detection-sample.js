import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function exportStratifiedSample() {
  console.log('Exporting stratified sample of videos for format detection testing...');
  
  try {
    // First, get the topic categories to understand domains
    const { data: topicCategories, error: topicError } = await supabase
      .from('topic_categories')
      .select('*')
      .eq('level', 1)
      .not('name', 'is', null)
      .order('video_count', { ascending: false });
    
    if (topicError) {
      console.error('Error fetching topic categories:', topicError);
      return;
    }
    
    console.log('Found topic categories:', topicCategories.map(t => `${t.name} (${t.video_count} videos)`));
    
    const allSamples = [];
    
    // For each major topic category, get a diverse sample
    for (const topic of topicCategories) {
      console.log(`\nSampling from ${topic.name} (topic_id: ${topic.topic_id})...`);
      
      // Get high performers (top 20%)
      const { data: highPerformers, error: highError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topic.topic_id)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gte('performance_ratio', 2.0) // Videos performing 2x+ their channel average
        .order('view_count', { ascending: false })
        .limit(5);
      
      if (!highError && highPerformers) {
        allSamples.push(...highPerformers.map(v => ({ ...v, performance_tier: 'high', domain: topic.name })));
      }
      
      // Get medium performers (middle range)
      const { data: mediumPerformers, error: mediumError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topic.topic_id)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gte('performance_ratio', 0.5)
        .lte('performance_ratio', 1.5)
        .order('random()')
        .limit(5);
      
      if (!mediumError && mediumPerformers) {
        allSamples.push(...mediumPerformers.map(v => ({ ...v, performance_tier: 'medium', domain: topic.name })));
      }
      
      // Get low performers (bottom 20%)
      const { data: lowPerformers, error: lowError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topic.topic_id)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .lte('performance_ratio', 0.5)
        .gt('view_count', 0) // Exclude videos with 0 views
        .order('random()')
        .limit(3);
      
      if (!lowError && lowPerformers) {
        allSamples.push(...lowPerformers.map(v => ({ ...v, performance_tier: 'low', domain: topic.name })));
      }
    }
    
    // Add some recent videos (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: recentVideos, error: recentError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
      .gte('published_at', thirtyDaysAgo.toISOString())
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .order('view_count', { ascending: false })
      .limit(10);
    
    if (!recentError && recentVideos) {
      // Map topic IDs to names for recent videos
      const recentWithDomains = recentVideos.map(v => {
        const topic = topicCategories.find(t => t.topic_id === v.topic_level_1);
        return {
          ...v,
          performance_tier: v.performance_ratio >= 2 ? 'high' : v.performance_ratio <= 0.5 ? 'low' : 'medium',
          domain: topic ? topic.name : 'Uncategorized'
        };
      });
      allSamples.push(...recentWithDomains);
    }
    
    // Add some older videos (1+ year old) for comparison
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    const { data: olderVideos, error: olderError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
      .lte('published_at', oneYearAgo.toISOString())
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .order('view_count', { ascending: false })
      .limit(10);
    
    if (!olderError && olderVideos) {
      // Map topic IDs to names for older videos
      const olderWithDomains = olderVideos.map(v => {
        const topic = topicCategories.find(t => t.topic_id === v.topic_level_1);
        return {
          ...v,
          performance_tier: v.performance_ratio >= 2 ? 'high' : v.performance_ratio <= 0.5 ? 'low' : 'medium',
          domain: topic ? topic.name : 'Uncategorized'
        };
      });
      allSamples.push(...olderWithDomains);
    }
    
    // Remove duplicates based on video ID
    const uniqueSamples = Array.from(new Map(allSamples.map(v => [v.id, v])).values());
    
    // Limit to 100 videos and shuffle for variety
    const finalSample = uniqueSamples
      .sort(() => Math.random() - 0.5)
      .slice(0, 100);
    
    // Add some metadata to help with format detection
    const enrichedSample = finalSample.map(video => {
      // Extract potential format indicators from title
      const titleLower = video.title.toLowerCase();
      const formatHints = [];
      
      // Common format patterns
      if (titleLower.includes('how to') || titleLower.includes('tutorial')) formatHints.push('tutorial');
      if (titleLower.includes('review') || titleLower.includes('tested')) formatHints.push('review');
      if (titleLower.includes('build') || titleLower.includes('making')) formatHints.push('build/project');
      if (titleLower.includes('tour') || titleLower.includes('shop tour')) formatHints.push('tour/showcase');
      if (titleLower.includes('tips') || titleLower.includes('tricks')) formatHints.push('tips/advice');
      if (titleLower.includes('vs') || titleLower.includes('comparison')) formatHints.push('comparison');
      if (titleLower.includes('unboxing')) formatHints.push('unboxing');
      if (titleLower.includes('q&a') || titleLower.includes('questions')) formatHints.push('q&a');
      if (titleLower.includes('vlog') || titleLower.includes('day in')) formatHints.push('vlog');
      if (titleLower.includes('challenge')) formatHints.push('challenge');
      
      return {
        ...video,
        format_hints: formatHints,
        days_since_published: Math.floor((new Date() - new Date(video.published_at)) / (1000 * 60 * 60 * 24)),
        video_url: `https://youtube.com/watch?v=${video.id}`
      };
    });
    
    // Sort by domain and performance tier for easier analysis
    enrichedSample.sort((a, b) => {
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
      if (a.performance_tier !== b.performance_tier) {
        const tierOrder = { high: 0, medium: 1, low: 2 };
        return tierOrder[a.performance_tier] - tierOrder[b.performance_tier];
      }
      return b.view_count - a.view_count;
    });
    
    // Export to JSON
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = path.join(process.cwd(), 'exports', `format-detection-sample-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(enrichedSample, null, 2));
    
    console.log(`\nExported ${enrichedSample.length} videos to ${outputPath}`);
    
    // Print summary statistics
    const domainCounts = {};
    const tierCounts = { high: 0, medium: 0, low: 0 };
    
    enrichedSample.forEach(video => {
      domainCounts[video.domain] = (domainCounts[video.domain] || 0) + 1;
      tierCounts[video.performance_tier]++;
    });
    
    console.log('\nSample composition:');
    console.log('By domain:');
    Object.entries(domainCounts).forEach(([domain, count]) => {
      console.log(`  ${domain}: ${count} videos`);
    });
    
    console.log('\nBy performance tier:');
    Object.entries(tierCounts).forEach(([tier, count]) => {
      console.log(`  ${tier}: ${count} videos`);
    });
    
    console.log('\nFormat hints found:');
    const formatCounts = {};
    enrichedSample.forEach(video => {
      video.format_hints.forEach(hint => {
        formatCounts[hint] = (formatCounts[hint] || 0) + 1;
      });
    });
    
    Object.entries(formatCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([format, count]) => {
        console.log(`  ${format}: ${count} videos`);
      });
    
  } catch (error) {
    console.error('Error exporting sample:', error);
  }
}

// Run the export
exportStratifiedSample();