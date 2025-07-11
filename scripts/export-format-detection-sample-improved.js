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
    const samplesPerCategory = Math.floor(100 / topicCategories.length);
    
    // For each major topic category, get a diverse sample
    for (const topic of topicCategories) {
      console.log(`\nSampling from ${topic.name} (topic_id: ${topic.topic_id})...`);
      
      // Get high performers (videos with clear format indicators in titles)
      const { data: highPerformers, error: highError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topic.topic_id)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gt('view_count', 10000) // At least 10k views to ensure quality
        .or('title.ilike.%how to%,title.ilike.%review%,title.ilike.%build%,title.ilike.%making%,title.ilike.%tutorial%,title.ilike.%tips%,title.ilike.%tour%,title.ilike.%vs%,title.ilike.%comparison%,title.ilike.%unboxing%,title.ilike.%challenge%,title.ilike.%test%,title.ilike.%experiment%')
        .order('view_count', { ascending: false })
        .limit(Math.floor(samplesPerCategory * 0.4)); // 40% high performers
      
      if (!highError && highPerformers && highPerformers.length > 0) {
        allSamples.push(...highPerformers.map(v => ({ 
          ...v, 
          performance_tier: 'high', 
          domain: topic.name,
          selection_reason: 'high_performer_with_format_keywords'
        })));
      }
      
      // Get medium performers with diverse titles
      const { data: mediumPerformers, error: mediumError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topic.topic_id)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gte('view_count', 1000)
        .lte('view_count', 50000)
        .order('random()')
        .limit(Math.floor(samplesPerCategory * 0.4)); // 40% medium performers
      
      if (!mediumError && mediumPerformers && mediumPerformers.length > 0) {
        allSamples.push(...mediumPerformers.map(v => ({ 
          ...v, 
          performance_tier: 'medium', 
          domain: topic.name,
          selection_reason: 'medium_performer_diverse'
        })));
      }
      
      // Get some lower performers but still with meaningful views
      const { data: lowPerformers, error: lowError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topic.topic_id)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gte('view_count', 100)
        .lt('view_count', 1000)
        .order('random()')
        .limit(Math.floor(samplesPerCategory * 0.2)); // 20% lower performers
      
      if (!lowError && lowPerformers && lowPerformers.length > 0) {
        allSamples.push(...lowPerformers.map(v => ({ 
          ...v, 
          performance_tier: 'low', 
          domain: topic.name,
          selection_reason: 'lower_performer'
        })));
      }
    }
    
    // Add some recent trending videos (last 7 days with high view velocity)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const { data: recentTrending, error: recentError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
      .gte('published_at', sevenDaysAgo.toISOString())
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .gt('view_count', 5000) // Recent but already has traction
      .order('view_count', { ascending: false })
      .limit(15);
    
    if (!recentError && recentTrending) {
      const recentWithDomains = recentTrending.map(v => {
        const topic = topicCategories.find(t => t.topic_id === v.topic_level_1);
        return {
          ...v,
          performance_tier: 'recent_trending',
          domain: topic ? topic.name : 'Uncategorized',
          selection_reason: 'recent_trending_video'
        };
      });
      allSamples.push(...recentWithDomains);
    }
    
    // Add some viral videos from different time periods
    const { data: viralVideos, error: viralError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .gte('view_count', 1000000) // 1M+ views
      .order('random()')
      .limit(10);
    
    if (!viralError && viralVideos) {
      const viralWithDomains = viralVideos.map(v => {
        const topic = topicCategories.find(t => t.topic_id === v.topic_level_1);
        return {
          ...v,
          performance_tier: 'viral',
          domain: topic ? topic.name : 'Uncategorized',
          selection_reason: 'viral_video'
        };
      });
      allSamples.push(...viralWithDomains);
    }
    
    // Remove duplicates based on video ID
    const uniqueSamples = Array.from(new Map(allSamples.map(v => [v.id, v])).values());
    
    // If we don't have enough, add more random videos
    if (uniqueSamples.length < 100) {
      const needed = 100 - uniqueSamples.length;
      const { data: additionalVideos, error: additionalError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gt('view_count', 500)
        .order('random()')
        .limit(needed * 2); // Get extra to ensure we hit 100
      
      if (!additionalError && additionalVideos) {
        const additionalWithDomains = additionalVideos
          .filter(v => !uniqueSamples.find(s => s.id === v.id))
          .map(v => {
            const topic = topicCategories.find(t => t.topic_id === v.topic_level_1);
            const viewCount = v.view_count;
            let tier = 'medium';
            if (viewCount >= 100000) tier = 'high';
            else if (viewCount < 1000) tier = 'low';
            
            return {
              ...v,
              performance_tier: tier,
              domain: topic ? topic.name : 'Uncategorized',
              selection_reason: 'additional_for_diversity'
            };
          });
        uniqueSamples.push(...additionalWithDomains);
      }
    }
    
    // Limit to exactly 100 videos
    const finalSample = uniqueSamples.slice(0, 100);
    
    // Add format detection metadata
    const enrichedSample = finalSample.map(video => {
      const titleLower = video.title.toLowerCase();
      const formatIndicators = [];
      
      // Comprehensive format detection patterns
      const formatPatterns = {
        'tutorial': ['how to', 'tutorial', 'guide', 'learn', 'beginner', 'basics', 'step by step', 'diy'],
        'review': ['review', 'tested', 'testing', 'honest', 'worth it', 'should you buy', 'first impressions'],
        'build_project': ['build', 'making', 'built', 'created', 'project', 'from scratch', 'restoration'],
        'showcase': ['tour', 'shop tour', 'setup', 'my workshop', 'workspace', 'collection'],
        'tips_tricks': ['tips', 'tricks', 'hacks', 'secrets', 'mistakes', 'things i wish'],
        'comparison': [' vs ', 'versus', 'comparison', 'which is better', 'shootout', 'head to head'],
        'unboxing': ['unboxing', 'unbox', 'first look', 'what\'s in the box'],
        'qa_discussion': ['q&a', 'questions', 'answering', 'ask me', 'ama', 'discussion'],
        'vlog': ['vlog', 'day in', 'week in', 'behind the scenes', 'life of'],
        'challenge': ['challenge', '24 hours', '30 days', 'can i', 'trying to'],
        'compilation': ['compilation', 'best of', 'top 10', 'top 5', 'fails', 'moments'],
        'experiment': ['experiment', 'what happens', 'testing', 'myth', 'science'],
        'news_update': ['news', 'update', 'announcement', 'launched', 'released'],
        'story_time': ['story time', 'storytime', 'what happened', 'my experience']
      };
      
      // Check each pattern
      for (const [format, patterns] of Object.entries(formatPatterns)) {
        if (patterns.some(pattern => titleLower.includes(pattern))) {
          formatIndicators.push(format);
        }
      }
      
      // Additional metadata
      const publishedDate = new Date(video.published_at);
      const daysSince = Math.floor((new Date() - publishedDate) / (1000 * 60 * 60 * 24));
      
      return {
        ...video,
        format_indicators: formatIndicators,
        format_confidence: formatIndicators.length > 0 ? 'high' : 'low',
        days_since_published: daysSince,
        age_category: daysSince < 7 ? 'very_recent' : daysSince < 30 ? 'recent' : daysSince < 90 ? 'few_months' : daysSince < 365 ? 'this_year' : 'older',
        video_url: `https://youtube.com/watch?v=${video.id}`,
        title_length: video.title.length,
        has_numbers: /\d/.test(video.title),
        has_caps: video.title !== video.title.toLowerCase(),
        has_emoji: /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(video.title)
      };
    });
    
    // Sort by domain and performance tier for easier analysis
    enrichedSample.sort((a, b) => {
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
      const tierOrder = { viral: 0, recent_trending: 1, high: 2, medium: 3, low: 4 };
      if (a.performance_tier !== b.performance_tier) {
        return (tierOrder[a.performance_tier] || 5) - (tierOrder[b.performance_tier] || 5);
      }
      return b.view_count - a.view_count;
    });
    
    // Export to JSON
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(process.cwd(), 'exports', `format-detection-sample-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(enrichedSample, null, 2));
    
    console.log(`\nExported ${enrichedSample.length} videos to ${outputPath}`);
    
    // Print detailed statistics
    const stats = {
      domains: {},
      tiers: {},
      formats: {},
      age_categories: {},
      selection_reasons: {}
    };
    
    enrichedSample.forEach(video => {
      stats.domains[video.domain] = (stats.domains[video.domain] || 0) + 1;
      stats.tiers[video.performance_tier] = (stats.tiers[video.performance_tier] || 0) + 1;
      stats.age_categories[video.age_category] = (stats.age_categories[video.age_category] || 0) + 1;
      stats.selection_reasons[video.selection_reason] = (stats.selection_reasons[video.selection_reason] || 0) + 1;
      
      video.format_indicators.forEach(format => {
        stats.formats[format] = (stats.formats[format] || 0) + 1;
      });
    });
    
    console.log('\n=== Sample Composition ===');
    
    console.log('\nBy Domain:');
    Object.entries(stats.domains)
      .sort(([, a], [, b]) => b - a)
      .forEach(([domain, count]) => {
        console.log(`  ${domain}: ${count} videos (${(count/enrichedSample.length*100).toFixed(1)}%)`);
      });
    
    console.log('\nBy Performance Tier:');
    Object.entries(stats.tiers)
      .forEach(([tier, count]) => {
        console.log(`  ${tier}: ${count} videos (${(count/enrichedSample.length*100).toFixed(1)}%)`);
      });
    
    console.log('\nBy Age Category:');
    Object.entries(stats.age_categories)
      .forEach(([age, count]) => {
        console.log(`  ${age}: ${count} videos`);
      });
    
    console.log('\nFormat Indicators Found:');
    Object.entries(stats.formats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([format, count]) => {
        console.log(`  ${format}: ${count} videos`);
      });
    
    console.log('\nSelection Reasons:');
    Object.entries(stats.selection_reasons)
      .forEach(([reason, count]) => {
        console.log(`  ${reason}: ${count} videos`);
      });
    
    // Sample of videos with clear formats
    console.log('\n=== Sample Videos with Clear Formats ===');
    const clearFormatVideos = enrichedSample
      .filter(v => v.format_indicators.length > 0)
      .slice(0, 5);
    
    clearFormatVideos.forEach(video => {
      console.log(`\n"${video.title}"`);
      console.log(`  Channel: ${video.channel_name}`);
      console.log(`  Views: ${video.view_count.toLocaleString()}`);
      console.log(`  Formats detected: ${video.format_indicators.join(', ')}`);
      console.log(`  Domain: ${video.domain}`);
    });
    
  } catch (error) {
    console.error('Error exporting sample:', error);
  }
}

// Run the export
exportStratifiedSample();