import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkVideosColumns() {
  console.log('Checking videos table columns...\n');
  
  try {
    // Get one record to see all columns
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('Error querying videos table:', error.message);
      return;
    }
    
    if (data && data.length > 0) {
      const columns = Object.keys(data[0]).sort();
      console.log('VIDEOS TABLE COLUMNS:');
      console.log('====================\n');
      
      // Group columns by category
      const embeddingColumns = columns.filter(col => 
        col.includes('embedding') || col.includes('vector') || col.includes('embed'));
      const syncColumns = columns.filter(col => 
        col.includes('sync') || col.includes('import') || col.includes('export') || 
        col.includes('source') || col.includes('competitor'));
      const otherColumns = columns.filter(col => 
        !embeddingColumns.includes(col) && !syncColumns.includes(col));
      
      console.log('EMBEDDING-RELATED COLUMNS:');
      embeddingColumns.forEach(col => {
        const value = data[0][col];
        const type = Array.isArray(value) ? `array[${value.length}]` : typeof value;
        console.log(`  - ${col} (${type})`);
      });
      
      console.log('\nSYNC/IMPORT-RELATED COLUMNS:');
      syncColumns.forEach(col => {
        const value = data[0][col];
        const type = typeof value;
        const displayValue = value === null ? 'null' : 
          (type === 'string' && value.length > 50) ? value.substring(0, 50) + '...' : value;
        console.log(`  - ${col} (${type}): ${displayValue}`);
      });
      
      console.log('\nOTHER COLUMNS:');
      otherColumns.forEach(col => {
        const value = data[0][col];
        const type = typeof value;
        console.log(`  - ${col} (${type})`);
      });
      
      console.log('\nTOTAL COLUMNS:', columns.length);
    } else {
      console.log('No records found in videos table');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkVideosColumns().catch(console.error);