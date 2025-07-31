const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchVideoData(limit = 5000) {
  console.log(`📥 Fetching ${limit} videos with LLM summaries...`);
  
  // Supabase has a default limit of 1000, so we need to fetch in batches
  let allVideos = [];
  let currentOffset = 0;
  const batchSize = 1000;
  
  while (allVideos.length < limit) {
    const remainingCount = limit - allVideos.length;
    const currentLimit = Math.min(batchSize, remainingCount);
    
    console.log(`  Fetching batch ${Math.floor(currentOffset/batchSize) + 1}... (${currentOffset} to ${currentOffset + currentLimit})`);
    
    const { data, error } = await supabase
      .from('videos')
      .select('id, title, llm_summary, channel_name, view_count, published_at')
      .not('llm_summary', 'is', null)
      .eq('llm_summary_embedding_synced', true)
      .not('title', 'is', null)
      .order('view_count', { ascending: false })
      .range(currentOffset, currentOffset + currentLimit - 1);

    if (error) {
      console.error('❌ Error fetching batch:', error);
      break;
    }

    if (!data || data.length === 0) {
      console.log('  No more data available');
      break;
    }

    allVideos = allVideos.concat(data);
    currentOffset += data.length;
    
    // If we got less than requested, we've reached the end
    if (data.length < currentLimit) {
      break;
    }
  }
  
  // Get total count for reporting
  const { count, error: countError } = await supabase
    .from('videos')
    .select('id', { count: 'exact' })
    .not('llm_summary', 'is', null)
    .eq('llm_summary_embedding_synced', true);

  if (countError) {
    console.error('❌ Error getting count:', countError);
  }

  console.log(`✅ Fetched ${allVideos.length} videos out of ${count || 'unknown'} total with LLM summaries`);
  return allVideos;
}

function createTextVariations(videos) {
  console.log('📝 Creating text variations...');
  
  const variations = {
    titles: videos.map(v => v.title),
    summaries: videos.map(v => v.llm_summary),
    combined: videos.map(v => `${v.title} ${v.title} ${v.llm_summary}`) // Title weighted 2x
  };
  
  console.log(`   - Titles: ${variations.titles.length} entries`);
  console.log(`   - Summaries: ${variations.summaries.length} entries`);
  console.log(`   - Combined: ${variations.combined.length} entries`);
  
  return variations;
}

function saveDataForPython(videos, textVariations) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const filename = `bertopic_data_${timestamp}.json`;
  
  const data = {
    metadata: {
      timestamp: new Date().toISOString(),
      total_videos: videos.length,
      unique_channels: [...new Set(videos.map(v => v.channel_name))].length,
      date_range: {
        earliest: Math.min(...videos.map(v => new Date(v.published_at).getTime())),
        latest: Math.max(...videos.map(v => new Date(v.published_at).getTime()))
      }
    },
    videos: videos.map(v => ({
      id: v.id,
      title: v.title,
      channel_name: v.channel_name,
      view_count: v.view_count,
      published_at: v.published_at
    })),
    text_variations: textVariations
  };
  
  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`💾 Data saved to ${filename}`);
  
  return filename;
}

async function main() {
  console.log('🚀 BERTopic Data Preparation');
  console.log('='*60);
  
  // Fetch video data
  const videos = await fetchVideoData(10000); // 10K for larger test
  
  if (!videos || videos.length === 0) {
    console.log('❌ No videos found');
    return;
  }
  
  // Create text variations
  const textVariations = createTextVariations(videos);
  
  // Save data for Python processing
  const filename = saveDataForPython(videos, textVariations);
  
  console.log(`
✅ Data preparation complete!

Next steps:
1. Install Python dependencies: pip install bertopic sentence-transformers umap-learn hdbscan
2. Use the saved ${filename} file for BERTopic analysis
3. Or run the full Python script with this data

Sample data:
- Total videos: ${videos.length.toLocaleString()}
- Unique channels: ${[...new Set(videos.map(v => v.channel_name))].length.toLocaleString()}
- Title example: "${videos[0].title}"
- Summary example: "${videos[0].llm_summary.substring(0, 100)}..."
`);
}

main().catch(console.error);