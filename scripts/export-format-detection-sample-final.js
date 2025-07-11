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
  console.log('Exporting stratified sample of 100 videos for format detection testing...');
  
  try {
    const allVideos = [];
    
    // Strategy 1: Get videos with clear format keywords in titles (40 videos)
    console.log('\nFetching videos with clear format indicators...');
    const formatKeywords = [
      'how to', 'tutorial', 'guide', 'review', 'build', 'making', 
      ' vs ', 'comparison', 'tips', 'tricks', 'tour', 'unboxing',
      'challenge', 'experiment', 'test'
    ];
    
    for (let i = 0; i < formatKeywords.length && allVideos.length < 40; i++) {
      const keyword = formatKeywords[i];
      const { data: formatVideos, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .ilike('title', `%${keyword}%`)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gte('view_count', 5000)
        .order('view_count', { ascending: false })
        .limit(5);
      
      if (!error && formatVideos) {
        allVideos.push(...formatVideos.map(v => ({
          ...v,
          selection_category: 'format_keyword',
          keyword_matched: keyword
        })));
      }
    }
    
    // Strategy 2: Get high-performing videos from each topic (30 videos)
    console.log('\nFetching high-performing videos by topic...');
    const topicIds = [-1, 0, 1, 2, 3, 4, 5]; // All topic categories
    
    for (const topicId of topicIds) {
      const { data: topicVideos, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .eq('topic_level_1', topicId)
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gte('view_count', 100000)
        .order('view_count', { ascending: false })
        .limit(5);
      
      if (!error && topicVideos) {
        allVideos.push(...topicVideos.map(v => ({
          ...v,
          selection_category: 'high_performer_by_topic',
          topic_sampled: topicId
        })));
      }
    }
    
    // Strategy 3: Get recent videos (last 30 days) with good performance (15 videos)
    console.log('\nFetching recent high-performing videos...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: recentVideos, error: recentError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
      .gte('published_at', thirtyDaysAgo.toISOString())
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .gte('view_count', 10000)
      .order('view_count', { ascending: false })
      .limit(15);
    
    if (!recentError && recentVideos) {
      allVideos.push(...recentVideos.map(v => ({
        ...v,
        selection_category: 'recent_high_performer'
      })));
    }
    
    // Strategy 4: Get diverse random sample to fill gaps (15+ videos)
    console.log('\nFetching diverse random videos...');
    const { data: randomVideos, error: randomError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .gte('view_count', 1000)
      .lte('view_count', 100000)
      .order('random()')
      .limit(30);
    
    if (!randomError && randomVideos) {
      allVideos.push(...randomVideos.map(v => ({
        ...v,
        selection_category: 'random_diverse'
      })));
    }
    
    // Remove duplicates
    const uniqueVideos = Array.from(new Map(allVideos.map(v => [v.id, v])).values());
    
    // If we still need more, get additional videos
    if (uniqueVideos.length < 100) {
      console.log(`\nNeed ${100 - uniqueVideos.length} more videos...`);
      const { data: additionalVideos, error: additionalError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at, topic_level_1, topic_level_2, performance_ratio')
        .not('title', 'is', null)
        .not('channel_name', 'is', null)
        .gt('view_count', 500)
        .order('random()')
        .limit(100 - uniqueVideos.length + 10); // Get extra to ensure we hit 100
      
      if (!additionalError && additionalVideos) {
        const newVideos = additionalVideos
          .filter(v => !uniqueVideos.find(u => u.id === v.id))
          .map(v => ({
            ...v,
            selection_category: 'additional_fill'
          }));
        uniqueVideos.push(...newVideos);
      }
    }
    
    // Get topic categories for domain mapping
    const { data: topicCategories } = await supabase
      .from('topic_categories')
      .select('*')
      .eq('level', 1)
      .not('name', 'is', null);
    
    // Take exactly 100 videos
    const finalSample = uniqueVideos.slice(0, 100);
    
    // Enrich with metadata
    const enrichedSample = finalSample.map(video => {
      // Map topic to domain name
      const topic = topicCategories?.find(t => t.topic_id === video.topic_level_1);
      const domain = topic ? topic.name : 'Uncategorized';
      
      // Detect formats
      const titleLower = video.title.toLowerCase();
      const formatIndicators = [];
      
      const formatPatterns = {
        'tutorial': ['how to', 'tutorial', 'guide', 'learn', 'beginner', 'diy', 'step by step'],
        'review': ['review', 'tested', 'testing', 'honest', 'worth it', 'first impressions'],
        'build_project': ['build', 'making', 'made', 'built', 'created', 'project'],
        'showcase': ['tour', 'shop tour', 'setup', 'my workshop', 'workspace'],
        'tips_tricks': ['tips', 'tricks', 'hacks', 'secrets', 'mistakes'],
        'comparison': [' vs ', 'versus', 'comparison', 'which is better'],
        'unboxing': ['unboxing', 'unbox', 'first look'],
        'qa_discussion': ['q&a', 'questions', 'answering', 'ask me'],
        'vlog': ['vlog', 'day in', 'week in', 'behind the scenes'],
        'challenge': ['challenge', '24 hours', '30 days', 'can i'],
        'compilation': ['compilation', 'best of', 'top 10', 'top 5'],
        'experiment': ['experiment', 'what happens', 'testing', 'test', 'science']
      };
      
      for (const [format, patterns] of Object.entries(formatPatterns)) {
        if (patterns.some(pattern => titleLower.includes(pattern))) {
          formatIndicators.push(format);
        }
      }
      
      // Performance tier
      let performanceTier = 'medium';
      if (video.view_count >= 1000000) performanceTier = 'viral';
      else if (video.view_count >= 100000) performanceTier = 'high';
      else if (video.view_count < 10000) performanceTier = 'low';
      
      // Age category
      const daysSince = Math.floor((new Date() - new Date(video.published_at)) / (1000 * 60 * 60 * 24));
      let ageCategory = 'older';
      if (daysSince < 7) ageCategory = 'very_recent';
      else if (daysSince < 30) ageCategory = 'recent';
      else if (daysSince < 90) ageCategory = 'few_months';
      else if (daysSince < 365) ageCategory = 'this_year';
      
      return {
        id: video.id,
        title: video.title,
        channel_name: video.channel_name,
        view_count: video.view_count,
        published_at: video.published_at,
        topic_level_1: video.topic_level_1,
        topic_level_2: video.topic_level_2,
        domain: domain,
        performance_tier: performanceTier,
        format_indicators: formatIndicators,
        format_confidence: formatIndicators.length > 0 ? 'high' : 'low',
        days_since_published: daysSince,
        age_category: ageCategory,
        selection_category: video.selection_category,
        keyword_matched: video.keyword_matched || null,
        video_url: `https://youtube.com/watch?v=${video.id}`,
        title_length: video.title.length,
        has_numbers: /\d/.test(video.title),
        has_caps: video.title !== video.title.toLowerCase(),
        has_exclamation: video.title.includes('!'),
        has_question: video.title.includes('?')
      };
    });
    
    // Sort by domain and view count for better organization
    enrichedSample.sort((a, b) => {
      if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
      return b.view_count - a.view_count;
    });
    
    // Export to JSON
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const outputPath = path.join(process.cwd(), 'exports', `format-detection-sample-100-videos-${timestamp}.json`);
    
    fs.writeFileSync(outputPath, JSON.stringify(enrichedSample, null, 2));
    
    console.log(`\n✅ Successfully exported ${enrichedSample.length} videos to:\n${outputPath}`);
    
    // Print comprehensive statistics
    const stats = {
      domains: {},
      performanceTiers: {},
      formats: {},
      ageCategories: {},
      selectionCategories: {},
      formatConfidence: { high: 0, low: 0 }
    };
    
    enrichedSample.forEach(video => {
      stats.domains[video.domain] = (stats.domains[video.domain] || 0) + 1;
      stats.performanceTiers[video.performance_tier] = (stats.performanceTiers[video.performance_tier] || 0) + 1;
      stats.ageCategories[video.age_category] = (stats.ageCategories[video.age_category] || 0) + 1;
      stats.selectionCategories[video.selection_category] = (stats.selectionCategories[video.selection_category] || 0) + 1;
      stats.formatConfidence[video.format_confidence]++;
      
      video.format_indicators.forEach(format => {
        stats.formats[format] = (stats.formats[format] || 0) + 1;
      });
    });
    
    console.log('\n📊 SAMPLE STATISTICS');
    console.log('==================');
    
    console.log('\n🎯 By Domain:');
    Object.entries(stats.domains)
      .sort(([, a], [, b]) => b - a)
      .forEach(([domain, count]) => {
        console.log(`  ${domain}: ${count} videos (${(count/enrichedSample.length*100).toFixed(1)}%)`);
      });
    
    console.log('\n📈 By Performance Tier:');
    Object.entries(stats.performanceTiers)
      .forEach(([tier, count]) => {
        console.log(`  ${tier}: ${count} videos (${(count/enrichedSample.length*100).toFixed(1)}%)`);
      });
    
    console.log('\n📅 By Age:');
    Object.entries(stats.ageCategories)
      .forEach(([age, count]) => {
        console.log(`  ${age}: ${count} videos`);
      });
    
    console.log('\n🎬 Format Indicators Found:');
    Object.entries(stats.formats)
      .sort(([, a], [, b]) => b - a)
      .forEach(([format, count]) => {
        console.log(`  ${format}: ${count} videos`);
      });
    
    console.log(`\n🎯 Format Detection Confidence:`);
    console.log(`  High confidence: ${stats.formatConfidence.high} videos`);
    console.log(`  Low confidence: ${stats.formatConfidence.low} videos`);
    
    // Show example videos
    console.log('\n📹 SAMPLE VIDEOS BY FORMAT');
    console.log('========================');
    
    const formatExamples = {
      'tutorial': 2,
      'review': 2,
      'comparison': 2,
      'build_project': 2,
      'experiment': 2
    };
    
    for (const [format, count] of Object.entries(formatExamples)) {
      const examples = enrichedSample
        .filter(v => v.format_indicators.includes(format))
        .slice(0, count);
      
      if (examples.length > 0) {
        console.log(`\n${format.toUpperCase()}:`);
        examples.forEach(video => {
          console.log(`  "${video.title}"`);
          console.log(`   - ${video.channel_name} | ${video.view_count.toLocaleString()} views | ${video.domain}`);
        });
      }
    }
    
  } catch (error) {
    console.error('Error exporting sample:', error);
  }
}

// Run the export
exportStratifiedSample();