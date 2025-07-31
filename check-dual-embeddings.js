import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables. Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkDualEmbeddings() {
  try {
    // First query: Count videos with both embeddings
    console.log('\n=== Counting videos with both title and summary embeddings ===');
    const { count: dualEmbeddingCount, error: countError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary_embedding_synced', true)
      .eq('pinecone_embedded', true);

    if (countError) {
      console.error('Error counting videos:', countError);
      return;
    }

    console.log(`Total videos with both embeddings: ${dualEmbeddingCount}`);

    // Second query: Get sample videos
    console.log('\n=== Sample videos with both embeddings (top 5 by views) ===');
    const { data: sampleData, error: sampleError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count')
      .eq('llm_summary_embedding_synced', true)
      .eq('pinecone_embedded', true)
      .order('view_count', { ascending: false })
      .limit(5);

    if (sampleError) {
      console.error('Error fetching sample videos:', sampleError);
      return;
    }

    if (sampleData && sampleData.length > 0) {
      console.table(sampleData);
    } else {
      console.log('No videos found with both embeddings.');
    }

    // Additional check: Count videos with only title embeddings
    console.log('\n=== Additional stats ===');
    const { count: titleOnlyCount, error: titleOnlyError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('pinecone_embedded', true)
      .eq('llm_summary_embedding_synced', false);

    if (!titleOnlyError) {
      console.log(`Videos with only title embeddings: ${titleOnlyCount}`);
    }

    // Count videos with only summary embeddings
    const { count: summaryOnlyCount, error: summaryOnlyError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary_embedding_synced', true)
      .eq('pinecone_embedded', false);

    if (!summaryOnlyError) {
      console.log(`Videos with only summary embeddings: ${summaryOnlyCount}`);
    }

    // Total videos
    const { count: totalCount, error: totalError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });

    if (!totalError) {
      console.log(`Total videos in database: ${totalCount}`);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkDualEmbeddings();