import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findVideosWithEmbeddings() {
  // Find videos that claim to have embeddings synced
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, pinecone_embedded, embedding_thumbnail_synced, llm_summary_embedding_synced')
    .or('pinecone_embedded.eq.true,embedding_thumbnail_synced.eq.true,llm_summary_embedding_synced.eq.true')
    .limit(10);

  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }

  console.log('Videos with embeddings synced:\n');
  videos.forEach(video => {
    console.log(`ID: ${video.id}`);
    console.log(`Title: ${video.title}`);
    console.log(`Title embedding: ${video.pinecone_embedded ? '✓' : '✗'}`);
    console.log(`Thumbnail embedding: ${video.embedding_thumbnail_synced ? '✓' : '✗'}`);
    console.log(`Summary embedding: ${video.llm_summary_embedding_synced ? '✓' : '✗'}`);
    console.log('---');
  });

  // Return first video ID that has all embeddings
  const videoWithAllEmbeddings = videos.find(v => 
    v.pinecone_embedded && 
    v.embedding_thumbnail_synced && 
    v.llm_summary_embedding_synced
  );

  if (videoWithAllEmbeddings) {
    console.log(`\nTesting with video that has all embeddings: ${videoWithAllEmbeddings.id}`);
    return videoWithAllEmbeddings.id;
  }

  // Otherwise return one with at least title embedding
  const videoWithTitleEmbedding = videos.find(v => v.pinecone_embedded);
  if (videoWithTitleEmbedding) {
    console.log(`\nTesting with video that has title embedding: ${videoWithTitleEmbedding.id}`);
    return videoWithTitleEmbedding.id;
  }

  return null;
}

findVideosWithEmbeddings();