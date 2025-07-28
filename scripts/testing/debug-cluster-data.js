#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(dirname(__dirname), '.env.local') });
dotenv.config({ path: join(dirname(__dirname), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugClusterData() {
  console.log('🔍 Debugging cluster data...\n');
  
  try {
    // Get one cluster
    const { data, error } = await supabase
      .from('bertopic_clusters')
      .select('*')
      .limit(1)
      .single();
      
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('Cluster ID:', data.cluster_id);
    console.log('Topic Name:', data.topic_name);
    console.log('Centroid embedding type:', typeof data.centroid_embedding);
    console.log('Centroid embedding sample:', data.centroid_embedding);
    
    if (typeof data.centroid_embedding === 'string') {
      console.log('\n⚠️  Centroid is a string, needs parsing!');
      // Try to parse it
      const parsed = data.centroid_embedding.slice(1, -1).split(',').map(Number);
      console.log('Parsed length:', parsed.length);
      console.log('First 5 values:', parsed.slice(0, 5));
    } else if (Array.isArray(data.centroid_embedding)) {
      console.log('\n✅ Centroid is already an array');
      console.log('Array length:', data.centroid_embedding.length);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

debugClusterData();