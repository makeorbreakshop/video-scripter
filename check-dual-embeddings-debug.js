import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkDualEmbeddings() {
  try {
    // First, let's check some sample data to understand the values
    console.log('\n=== Checking sample data to understand values ===');
    const { data: sampleCheck, error: sampleCheckError } = await supabase
      .from('videos')
      .select('id, title, llm_summary_embedding_synced, pinecone_embedded')
      .limit(10);

    if (sampleCheckError) {
      console.error('Error checking sample data:', sampleCheckError);
    } else {
      console.table(sampleCheck);
    }

    // Now let's try different queries
    console.log('\n=== Trying different query approaches ===');
    
    // Query 1: Using is operator
    const { count: count1, error: error1 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary_embedding_synced', true)
      .is('pinecone_embedded', true);
    
    if (!error1) {
      console.log(`Using .is() - Videos with both embeddings: ${count1}`);
    }

    // Query 2: Using raw SQL
    const { data: rawData, error: rawError } = await supabase
      .rpc('execute_sql', {
        query: `
          SELECT COUNT(*) as count
          FROM videos
          WHERE llm_summary_embedding_synced = true
          AND pinecone_embedded = true
        `
      });

    if (!rawError && rawData) {
      console.log(`Using raw SQL - Videos with both embeddings: ${rawData[0]?.count || 0}`);
    }

    // Query 3: Get counts for each combination
    console.log('\n=== Embedding combinations ===');
    
    const combinations = [
      { llm: true, pinecone: true, label: 'Both embeddings' },
      { llm: true, pinecone: false, label: 'Only LLM summary embedding' },
      { llm: false, pinecone: true, label: 'Only Pinecone (title) embedding' },
      { llm: false, pinecone: false, label: 'No embeddings' }
    ];

    for (const combo of combinations) {
      const { count, error } = await supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('llm_summary_embedding_synced', combo.llm)
        .eq('pinecone_embedded', combo.pinecone);
      
      if (!error) {
        console.log(`${combo.label}: ${count}`);
      }
    }

    // Get total count
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\nTotal videos: ${totalCount}`);

    // Finally, get some example videos with both embeddings
    console.log('\n=== Example videos with both embeddings ===');
    const { data: exampleVideos, error: exampleError } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count')
      .eq('llm_summary_embedding_synced', true)
      .eq('pinecone_embedded', true)
      .order('view_count', { ascending: false })
      .limit(5);

    if (!exampleError && exampleVideos && exampleVideos.length > 0) {
      console.table(exampleVideos);
    } else {
      console.log('No videos found with both embeddings.');
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkDualEmbeddings();