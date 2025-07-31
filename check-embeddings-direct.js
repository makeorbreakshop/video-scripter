import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkEmbeddings() {
  try {
    // Get videos with both embeddings set to true
    console.log('\n=== Videos with BOTH embeddings ===');
    const { data: bothEmbeddings, error: bothError, count: bothCount } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, llm_summary_embedding_synced, pinecone_embedded', { count: 'exact' })
      .eq('llm_summary_embedding_synced', true)
      .eq('pinecone_embedded', true)
      .order('view_count', { ascending: false })
      .limit(10);

    if (bothError) {
      console.error('Error:', bothError);
    } else {
      console.log(`Count: ${bothCount}`);
      if (bothEmbeddings && bothEmbeddings.length > 0) {
        console.table(bothEmbeddings);
      }
    }

    // Get videos with LLM summary embedding only
    console.log('\n=== Videos with LLM summary embedding ONLY ===');
    const { count: llmOnlyCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary_embedding_synced', true)
      .eq('pinecone_embedded', false);
    
    console.log(`Count: ${llmOnlyCount}`);

    // Get videos with Pinecone embedding only
    console.log('\n=== Videos with Pinecone (title) embedding ONLY ===');
    const { count: pineconeOnlyCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary_embedding_synced', false)
      .eq('pinecone_embedded', true);
    
    console.log(`Count: ${pineconeOnlyCount}`);

    // Get videos with neither embedding
    console.log('\n=== Videos with NO embeddings ===');
    const { count: noEmbeddingsCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary_embedding_synced', false)
      .eq('pinecone_embedded', false);
    
    console.log(`Count: ${noEmbeddingsCount}`);

    // Get total videos
    console.log('\n=== Total videos ===');
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    console.log(`Count: ${totalCount}`);

    // Check for null values
    console.log('\n=== Checking for NULL values ===');
    const { count: llmNullCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary_embedding_synced', null);
    
    console.log(`Videos with NULL llm_summary_embedding_synced: ${llmNullCount}`);

    const { count: pineconeNullCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('pinecone_embedded', null);
    
    console.log(`Videos with NULL pinecone_embedded: ${pineconeNullCount}`);

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkEmbeddings();