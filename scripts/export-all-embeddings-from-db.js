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

async function exportAllEmbeddingsFromDatabase() {
  const exportsDir = path.join(__dirname, '../exports');
  const outputFile = path.join(exportsDir, 'all-title-embeddings-from-db.json');
  const csvFile = path.join(exportsDir, 'all-title-embeddings-for-bertopic.csv');
  
  console.log('🔍 Fetching all videos with embeddings from database...');
  
  // First, get the count
  const { count } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('pinecone_embedded', true);
  
  console.log(`📊 Found ${count} videos with embeddings in database`);
  
  // Fetch all videos with embeddings in batches
  const batchSize = 1000;
  const allVideos = [];
  
  for (let i = 0; i < count; i += batchSize) {
    console.log(`   Fetching batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(count/batchSize)}...`);
    
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
        performance_ratio,
        rolling_baseline_views
      `)
      .eq('pinecone_embedded', true)
      .range(i, i + batchSize - 1);
    
    if (error) {
      console.error('❌ Database error:', error);
      continue;
    }
    
    allVideos.push(...data);
  }
  
  console.log(`✅ Retrieved ${allVideos.length} videos from database`);
  
  // Now we need to get the actual embeddings from Pinecone
  // But first, let's create the metadata structure
  const exportData = {
    export_info: {
      timestamp: new Date().toISOString(),
      total_videos: allVideos.length,
      source: 'database_direct',
      dimension: 512,
      type: 'complete_database_export'
    },
    videos: allVideos
  };
  
  // Save the metadata
  fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
  console.log(`💾 Video metadata saved to: ${outputFile}`);
  
  // Create CSV for BERTopic (without embeddings first, we'll add them from Pinecone)
  const csvLines = ['video_id,title,description,channel_name,view_count,performance_ratio,is_competitor,topic_cluster,published_at,rolling_baseline_views'];
  
  for (const video of allVideos) {
    const title = (video.title || '').replace(/"/g, '""');
    const description = (video.description || '').replace(/"/g, '""').substring(0, 500);
    const channelName = (video.channel_name || '').replace(/"/g, '""');
    
    csvLines.push([
      `"${video.id}"`,
      `"${title}"`,
      `"${description}"`,
      `"${channelName}"`,
      video.view_count || 0,
      video.performance_ratio || 1.0,
      video.is_competitor || false,
      video.topic_cluster || '',
      `"${video.published_at || ''}"`,
      video.rolling_baseline_views || 0
    ].join(','));
  }
  
  fs.writeFileSync(csvFile, csvLines.join('\n'));
  console.log(`📊 CSV metadata file saved to: ${csvFile}`);
  
  return {
    totalVideos: allVideos.length,
    outputFile,
    csvFile
  };
}

// Run the export
exportAllEmbeddingsFromDatabase()
  .then(result => {
    console.log('\\n✅ Database export completed successfully');
    console.log(`📊 Exported metadata for ${result.totalVideos} videos`);
    console.log('\\n📝 Next step: Export embeddings from Pinecone using the video IDs');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Error during export:', error);
    process.exit(1);
  });