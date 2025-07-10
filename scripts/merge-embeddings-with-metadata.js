import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function mergeEmbeddingsWithMetadata() {
  const exportsDir = path.join(__dirname, '../exports');
  const aggregatedFile = path.join(exportsDir, 'title-embeddings-aggregated.json');
  const outputFile = path.join(exportsDir, 'title-embeddings-with-metadata.json');
  
  console.log('📂 Loading aggregated embeddings...');
  const embeddingsData = JSON.parse(fs.readFileSync(aggregatedFile, 'utf8'));
  
  console.log(`📊 Found ${embeddingsData.embeddings.length} embeddings to enhance`);
  
  // Get video IDs for database lookup
  const videoIds = embeddingsData.embeddings.map(item => item.id);
  
  console.log('🔍 Fetching video metadata from database...');
  
  // Fetch metadata in batches to avoid query limits
  const batchSize = 1000;
  const videoMetadata = new Map();
  
  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    console.log(`   Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(videoIds.length/batchSize)}...`);
    
    const { data, error } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        description,
        channel_id,
        channel_name,
        view_count,
        like_count,
        comment_count,
        duration,
        published_at,
        is_competitor,
        topic_cluster,
        performance_ratio
      `)
      .in('id', batch);
    
    if (error) {
      console.error('❌ Database error:', error);
      continue;
    }
    
    data.forEach(video => {
      videoMetadata.set(video.id, video);
    });
  }
  
  console.log(`✅ Retrieved metadata for ${videoMetadata.size} videos`);
  
  // Merge embeddings with enhanced metadata
  const enhancedEmbeddings = embeddingsData.embeddings.map(item => {
    const dbMetadata = videoMetadata.get(item.id);
    
    return {
      id: item.id,
      values: item.values,
      metadata: {
        // Keep original metadata
        ...item.metadata,
        // Add database metadata
        description: dbMetadata?.description || '',
        channel_id: dbMetadata?.channel_id || item.metadata.channel_id,
        channel_title: dbMetadata?.channel_name || item.metadata.channel_name,
        view_count: dbMetadata?.view_count || item.metadata.view_count,
        like_count: dbMetadata?.like_count || 0,
        comment_count: dbMetadata?.comment_count || 0,
        duration: dbMetadata?.duration || '',
        published_at: dbMetadata?.published_at || '',
        is_competitor: dbMetadata?.is_competitor || false,
        topic_cluster: dbMetadata?.topic_cluster || null,
        performance_ratio: dbMetadata?.performance_ratio || item.metadata.performance_ratio || 1.0
      }
    };
  });
  
  const enhancedData = {
    export_info: {
      ...embeddingsData.export_info,
      timestamp: new Date().toISOString(),
      enhanced_with_database: true,
      database_matches: videoMetadata.size,
      type: 'enhanced_title_embeddings'
    },
    embeddings: enhancedEmbeddings
  };
  
  // Save enhanced embeddings
  fs.writeFileSync(outputFile, JSON.stringify(enhancedData, null, 2));
  console.log(`💾 Enhanced embeddings saved to: ${outputFile}`);
  
  // Create enhanced CSV for BERTopic
  const csvFile = path.join(exportsDir, 'title-embeddings-enhanced-for-bertopic.csv');
  const csvLines = ['video_id,title,description,channel_title,view_count,performance_ratio,is_competitor,topic_cluster,published_at,embedding'];
  
  for (const item of enhancedEmbeddings) {
    const embedding = item.values.join(',');
    const title = (item.metadata.title || '').replace(/"/g, '""');
    const description = (item.metadata.description || '').replace(/"/g, '""').substring(0, 500); // Limit description length
    const channelTitle = (item.metadata.channel_title || '').replace(/"/g, '""');
    
    csvLines.push([
      `"${item.id}"`,
      `"${title}"`,
      `"${description}"`,
      `"${channelTitle}"`,
      item.metadata.view_count || 0,
      item.metadata.performance_ratio || 1.0,
      item.metadata.is_competitor || false,
      item.metadata.topic_cluster || '',
      `"${item.metadata.published_at || ''}"`,
      `"${embedding}"`
    ].join(','));
  }
  
  fs.writeFileSync(csvFile, csvLines.join('\n'));
  console.log(`📊 Enhanced CSV file for BERTopic saved to: ${csvFile}`);
  
  return {
    totalEmbeddings: enhancedEmbeddings.length,
    databaseMatches: videoMetadata.size,
    outputFile,
    csvFile
  };
}

// Run the merge
mergeEmbeddingsWithMetadata()
  .then(result => {
    console.log('\\n✅ Embeddings enhancement completed successfully');
    console.log(`📊 Enhanced ${result.totalEmbeddings} embeddings with ${result.databaseMatches} database matches`);
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error during enhancement:', error);
    process.exit(1);
  });