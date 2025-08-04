import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkSchema() {
  try {
    // Try to get one video to see its columns
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .limit(1);

    if (error) {
      console.error('Error fetching video:', error);
      return;
    }

    if (data && data.length > 0) {
      console.log('Video columns:', Object.keys(data[0]));
      console.log('\nChecking for embedding-related columns:');
      const video = data[0];
      
      // Check for various embedding-related columns
      const possibleColumns = [
        'llm_summary_embedding_synced',
        'llm_summary_embedded',
        'summary_embedding_synced',
        'summary_embedded',
        'pinecone_embedded',
        'title_embedded',
        'embedding_synced',
        'has_embedding',
        'embedding',
        'title_embedding',
        'summary_embedding'
      ];
      
      possibleColumns.forEach(col => {
        if (col in video) {
          console.log(`✓ ${col}: ${video[col]}`);
        }
      });
    } else {
      console.log('No videos found in database');
    }
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkSchema();