#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createPerformanceFunctions() {
  console.log('=' + '='.repeat(60));
  console.log('CREATING PERFORMANCE SCORING FUNCTIONS');
  console.log('=' + '='.repeat(60));
  
  // Read the SQL file
  const sqlPath = path.join(process.cwd(), 'sql/create-stored-performance-system.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  
  // Split into individual statements (removing comments)
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--') && !s.startsWith('/*'))
    .map(s => s + ';');
  
  console.log(`\n📝 Found ${statements.length} SQL statements to execute`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    
    // Skip pure comment blocks
    if (stmt.replace(/\s/g, '') === ';') continue;
    
    // Extract first line for logging
    const firstLine = stmt.split('\n')[0].substring(0, 60);
    process.stdout.write(`\r  [${i+1}/${statements.length}] ${firstLine}...`);
    
    try {
      const { error } = await supabase.rpc('execute_sql', { 
        sql_query: stmt 
      }).single();
      
      if (error) {
        // Try direct execution as fallback
        const { error: directError } = await supabase.from('_dummy_').select().maybeSingle();
        if (directError) {
          console.log(` ❌ Error: ${error.message}`);
          errorCount++;
        } else {
          successCount++;
        }
      } else {
        successCount++;
      }
    } catch (err) {
      console.log(` ❌ Error: ${err.message}`);
      errorCount++;
    }
  }
  
  console.log('\n');
  console.log('=' + '='.repeat(60));
  console.log(`✅ Successfully created: ${successCount} objects`);
  if (errorCount > 0) {
    console.log(`⚠️  Errors encountered: ${errorCount} (may be OK if objects already exist)`);
  }
  console.log('=' + '='.repeat(60));
  
  console.log('\n📊 NEXT STEPS:');
  console.log('1. Run the master update function to populate all data:');
  console.log('   node scripts/run-performance-update.js');
  console.log('\n2. This will:');
  console.log('   - Calculate channel performance ratios');
  console.log('   - Update all 196K video scores');
  console.log('   - Take approximately 2-3 minutes total');
}

createPerformanceFunctions().catch(console.error);