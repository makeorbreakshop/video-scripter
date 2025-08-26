import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
  try {
    // Get one video to see structure
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .limit(1);

    if (error) {
      console.error('Error:', error);
      return;
    }

    if (data && data.length > 0) {
      console.log('Video table columns:');
      Object.keys(data[0]).forEach(col => {
        console.log(`- ${col}`);
      });
    }

    // Check if title_embedding exists in another table
    const tables = ['video_embeddings', 'embeddings', 'video_title_embeddings'];
    
    for (const table of tables) {
      try {
        const { data: testData, error: testError } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (!testError && testData) {
          console.log(`\nFound table: ${table}`);
          if (testData.length > 0) {
            Object.keys(testData[0]).forEach(col => {
              console.log(`- ${col}`);
            });
          }
        }
      } catch (e) {
        // Table doesn't exist
      }
    }

    // Check specific embedding columns
    console.log('\nChecking for embedding columns...');
    const { data: embedData } = await supabase
      .from('videos')
      .select('id, title')
      .limit(1);

    if (embedData) {
      console.log('Videos table exists and is accessible');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

checkColumns();