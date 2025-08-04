import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkEmbeddingsSQL() {
  try {
    // Run a comprehensive SQL query
    const query = `
      WITH embedding_stats AS (
        SELECT 
          SUM(CASE WHEN llm_summary_embedding_synced = true AND pinecone_embedded = true THEN 1 ELSE 0 END) as both_embeddings,
          SUM(CASE WHEN llm_summary_embedding_synced = true AND pinecone_embedded = false THEN 1 ELSE 0 END) as llm_only,
          SUM(CASE WHEN llm_summary_embedding_synced = false AND pinecone_embedded = true THEN 1 ELSE 0 END) as pinecone_only,
          SUM(CASE WHEN llm_summary_embedding_synced = false AND pinecone_embedded = false THEN 1 ELSE 0 END) as no_embeddings,
          SUM(CASE WHEN llm_summary_embedding_synced IS NULL THEN 1 ELSE 0 END) as llm_null,
          SUM(CASE WHEN pinecone_embedded IS NULL THEN 1 ELSE 0 END) as pinecone_null,
          COUNT(*) as total
        FROM videos
      )
      SELECT * FROM embedding_stats;
    `;

    const { data: stats, error: statsError } = await supabase
      .rpc('exec_sql', { query });

    if (statsError) {
      // Try a simpler query if the RPC doesn't exist
      console.log('RPC function not available, trying direct queries...');
      
      // Just get a simple count first
      const { count: simpleCount, error: simpleError } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true });
      
      if (!simpleError) {
        console.log(`\nTotal videos in database: ${simpleCount}`);
      }

      // Try to get just 5 videos with both embeddings
      const { data: sampleBoth, error: sampleBothError } = await supabase
        .from('videos')
        .select('id, title, llm_summary_embedding_synced, pinecone_embedded')
        .eq('llm_summary_embedding_synced', true)
        .eq('pinecone_embedded', true)
        .limit(5);

      if (!sampleBothError) {
        console.log('\nVideos with both embeddings (sample):');
        if (sampleBoth && sampleBoth.length > 0) {
          console.table(sampleBoth);
        } else {
          console.log('No videos found with both embeddings set to true.');
        }
      }

      // Check the distribution of values
      const { data: distribution, error: distError } = await supabase
        .from('videos')
        .select('llm_summary_embedding_synced, pinecone_embedded')
        .limit(100);

      if (!distError && distribution) {
        const counts = {
          both: 0,
          llmOnly: 0,
          pineconeOnly: 0,
          neither: 0
        };

        distribution.forEach(video => {
          if (video.llm_summary_embedding_synced && video.pinecone_embedded) {
            counts.both++;
          } else if (video.llm_summary_embedding_synced && !video.pinecone_embedded) {
            counts.llmOnly++;
          } else if (!video.llm_summary_embedding_synced && video.pinecone_embedded) {
            counts.pineconeOnly++;
          } else {
            counts.neither++;
          }
        });

        console.log('\nDistribution in first 100 videos:');
        console.log(`Both embeddings: ${counts.both}`);
        console.log(`LLM summary only: ${counts.llmOnly}`);
        console.log(`Pinecone (title) only: ${counts.pineconeOnly}`);
        console.log(`Neither: ${counts.neither}`);
      }

    } else if (stats) {
      console.log('\n=== Embedding Statistics ===');
      console.log(`Videos with both embeddings: ${stats[0].both_embeddings}`);
      console.log(`Videos with LLM summary embedding only: ${stats[0].llm_only}`);
      console.log(`Videos with Pinecone (title) embedding only: ${stats[0].pinecone_only}`);
      console.log(`Videos with no embeddings: ${stats[0].no_embeddings}`);
      console.log(`Videos with NULL llm_summary_embedding_synced: ${stats[0].llm_null}`);
      console.log(`Videos with NULL pinecone_embedded: ${stats[0].pinecone_null}`);
      console.log(`Total videos: ${stats[0].total}`);
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkEmbeddingsSQL();