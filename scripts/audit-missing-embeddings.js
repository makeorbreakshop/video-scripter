import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  console.error('Please check your .env.local file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function loadAggregatedEmbeddings() {
  // Try multiple possible filenames
  const possiblePaths = [
    path.join(process.cwd(), 'exports', 'title-embeddings-complete-aggregated.json'),
    path.join(process.cwd(), 'exports', 'title-embeddings-aggregated.json'),
    path.join(process.cwd(), 'exports', 'aggregated_title_embeddings.json')
  ];
  
  for (const embeddingsPath of possiblePaths) {
    try {
      const data = await fs.readFile(embeddingsPath, 'utf-8');
      const parsed = JSON.parse(data);
      
      // Handle different file structures
      let embeddings = [];
      if (parsed.embeddings && Array.isArray(parsed.embeddings)) {
        // Structure with embeddings array
        embeddings = parsed.embeddings;
      } else if (Array.isArray(parsed)) {
        // Direct array of embeddings
        embeddings = parsed;
      } else {
        console.log(`Unknown structure in ${path.basename(embeddingsPath)}`);
        continue;
      }
      
      // Create a Set of video IDs that have embeddings
      // Check for different ID field names
      const videoIdsWithEmbeddings = new Set(embeddings.map(item => 
        item.video_id || item.id || item.video_id
      ));
      
      console.log(`Loaded ${embeddings.length} embeddings from ${path.basename(embeddingsPath)}`);
      
      return { embeddings, videoIdsWithEmbeddings };
    } catch (error) {
      console.log(`Error loading ${path.basename(embeddingsPath)}: ${error.message}`);
      continue;
    }
  }
  
  console.error('No aggregated embeddings file found');
  return { embeddings: [], videoIdsWithEmbeddings: new Set() };
}

async function getVideosNeedingClassification() {
  console.log('Fetching videos that need topic classification...');
  
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, channel_name, channel_id, published_at, view_count, duration, niche')
    .is('topic_level_1', null)
    .order('published_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching videos:', error);
    return [];
  }
  
  console.log(`Found ${videos.length} videos without topic classification`);
  return videos;
}

async function crossReferenceAndExport() {
  // Load aggregated embeddings
  const { embeddings, videoIdsWithEmbeddings } = await loadAggregatedEmbeddings();
  
  // Get videos needing classification
  const videosNeedingClassification = await getVideosNeedingClassification();
  
  // Cross-reference to find videos without embeddings
  const videosWithoutEmbeddings = [];
  const videosWithEmbeddings = [];
  
  for (const video of videosNeedingClassification) {
    if (videoIdsWithEmbeddings.has(video.id)) {
      videosWithEmbeddings.push(video);
    } else {
      videosWithoutEmbeddings.push(video);
    }
  }
  
  // Create exports directory if it doesn't exist
  const exportsDir = path.join(process.cwd(), 'exports', 'embedding-audit');
  await fs.mkdir(exportsDir, { recursive: true });
  
  // Export detailed lists
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Export videos without embeddings
  const withoutEmbeddingsPath = path.join(exportsDir, `videos_without_embeddings_${timestamp}.json`);
  await fs.writeFile(
    withoutEmbeddingsPath,
    JSON.stringify(videosWithoutEmbeddings, null, 2)
  );
  
  // Export videos with embeddings but no classification
  const withEmbeddingsPath = path.join(exportsDir, `videos_with_embeddings_no_classification_${timestamp}.json`);
  await fs.writeFile(
    withEmbeddingsPath,
    JSON.stringify(videosWithEmbeddings, null, 2)
  );
  
  // Create summary report
  const summary = {
    timestamp: new Date().toISOString(),
    totalVideosInDatabase: null, // Will be fetched
    totalVideosNeedingClassification: videosNeedingClassification.length,
    videosWithEmbeddings: videosWithEmbeddings.length,
    videosWithoutEmbeddings: videosWithoutEmbeddings.length,
    totalEmbeddingsInFile: embeddings.length,
    breakdown: {
      byChannel: {},
      byCategory: {},
      byYear: {}
    },
    topMissingVideos: videosWithoutEmbeddings.slice(0, 20).map(v => ({
      id: v.id,
      title: v.title,
      channel: v.channel_name,
      views: v.view_count,
      published: v.published_at
    }))
  };
  
  // Get total video count
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
  
  summary.totalVideosInDatabase = totalVideos;
  
  // Analyze breakdown for videos without embeddings
  for (const video of videosWithoutEmbeddings) {
    // By channel
    const channel = video.channel_name || 'Unknown';
    summary.breakdown.byChannel[channel] = (summary.breakdown.byChannel[channel] || 0) + 1;
    
    // By niche
    const niche = video.niche || 'Unknown';
    summary.breakdown.byCategory[niche] = (summary.breakdown.byCategory[niche] || 0) + 1;
    
    // By year
    const year = video.published_at ? new Date(video.published_at).getFullYear() : 'Unknown';
    summary.breakdown.byYear[year] = (summary.breakdown.byYear[year] || 0) + 1;
  }
  
  // Sort breakdowns
  summary.breakdown.byChannel = Object.fromEntries(
    Object.entries(summary.breakdown.byChannel).sort((a, b) => b[1] - a[1])
  );
  
  // Export summary
  const summaryPath = path.join(exportsDir, `embedding_audit_summary_${timestamp}.json`);
  await fs.writeFile(
    summaryPath,
    JSON.stringify(summary, null, 2)
  );
  
  // Export CSV for easy viewing
  const csvContent = [
    'video_id,title,channel,views,published_at,has_embedding',
    ...videosNeedingClassification.map(v => {
      const hasEmbedding = videoIdsWithEmbeddings.has(v.id);
      return `"${v.id}","${v.title?.replace(/"/g, '""')}","${v.channel_name?.replace(/"/g, '""')}",${v.view_count},"${v.published_at}",${hasEmbedding}`;
    })
  ].join('\n');
  
  const csvPath = path.join(exportsDir, `videos_needing_classification_${timestamp}.csv`);
  await fs.writeFile(csvPath, csvContent);
  
  // Print summary to console
  console.log('\n=== EMBEDDING AUDIT SUMMARY ===');
  console.log(`Total videos in database: ${summary.totalVideosInDatabase}`);
  console.log(`Videos needing topic classification: ${summary.totalVideosNeedingClassification}`);
  console.log(`  - With embeddings: ${summary.videosWithEmbeddings}`);
  console.log(`  - WITHOUT embeddings: ${summary.videosWithoutEmbeddings}`);
  console.log(`\nTotal embeddings in aggregated file: ${summary.totalEmbeddingsInFile}`);
  
  console.log('\nTop channels missing embeddings:');
  Object.entries(summary.breakdown.byChannel).slice(0, 10).forEach(([channel, count]) => {
    console.log(`  - ${channel}: ${count} videos`);
  });
  
  console.log('\nFiles exported to:');
  console.log(`  - Summary: ${summaryPath}`);
  console.log(`  - Videos without embeddings: ${withoutEmbeddingsPath}`);
  console.log(`  - Videos with embeddings: ${withEmbeddingsPath}`);
  console.log(`  - CSV report: ${csvPath}`);
  
  return summary;
}

// Run the audit
crossReferenceAndExport()
  .then(() => {
    console.log('\nAudit complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error during audit:', error);
    process.exit(1);
  });