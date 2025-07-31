import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkVideoColumns() {
  console.log('Checking videos table columns...\n');
  
  try {
    // First, get just one video to see all columns
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('Error:', error.message);
      return;
    }
    
    if (data && data.length > 0) {
      const columns = Object.keys(data[0]);
      console.log('All columns in videos table:');
      console.log('============================');
      columns.forEach(col => console.log(`- ${col}`));
      
      console.log('\n\nTopic/Category related columns:');
      console.log('==============================');
      const topicColumns = columns.filter(col => 
        col.includes('topic') || 
        col.includes('category') || 
        col.includes('cluster') || 
        col.includes('classification') ||
        col.includes('format') ||
        col.includes('bertopic')
      );
      
      if (topicColumns.length > 0) {
        topicColumns.forEach(col => {
          const value = data[0][col];
          const valueType = typeof value;
          console.log(`- ${col} (${valueType}): ${JSON.stringify(value)}`);
        });
      } else {
        console.log('No topic/category columns found');
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkVideoColumns();