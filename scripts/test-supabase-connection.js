#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Testing Supabase connection...');
console.log('URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function test() {
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('✅ Supabase client works! Video count:', data);
    }
    
    // Try to get database info
    const { data: dbData, error: dbError } = await supabase
      .rpc('current_database');
    
    if (!dbError) {
      console.log('Database name:', dbData);
    }
  } catch (e) {
    console.error('Exception:', e);
  }
}

test();