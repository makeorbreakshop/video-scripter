import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  console.log('Applying format classification migration...');
  
  try {
    // Add missing columns
    const { error: alterError } = await supabase.rpc('exec_sql', {
      query: `
        ALTER TABLE videos 
        ADD COLUMN IF NOT EXISTS video_format text,
        ADD COLUMN IF NOT EXISTS format_reasoning text;
      `
    });
    
    if (alterError) {
      console.error('Error adding columns:', alterError);
      // Try alternative approach
      console.log('Trying alternative approach...');
      
      // Add video_format column
      const { error: formatError } = await supabase.rpc('exec_sql', {
        query: `ALTER TABLE videos ADD COLUMN video_format text;`
      });
      
      if (formatError && !formatError.message.includes('already exists')) {
        throw formatError;
      }
      
      // Add format_reasoning column
      const { error: reasoningError } = await supabase.rpc('exec_sql', {
        query: `ALTER TABLE videos ADD COLUMN format_reasoning text;`
      });
      
      if (reasoningError && !reasoningError.message.includes('already exists')) {
        throw reasoningError;
      }
    }
    
    console.log('Columns added successfully!');
    
    // Verify columns exist
    const { data: columns, error: verifyError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'videos' 
        AND column_name IN ('video_format', 'format_confidence', 'format_reasoning', 'classified_at')
        ORDER BY column_name;
      `
    });
    
    if (verifyError) {
      console.error('Error verifying columns:', verifyError);
    } else {
      console.log('\nCurrent format classification columns:');
      console.table(columns);
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();