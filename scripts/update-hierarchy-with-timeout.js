import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Load the new hierarchy
const newMapping = JSON.parse(
  await fs.readFile('./data/bertopic/better_topic_names_v3_proper_hierarchy.json', 'utf-8')
);

async function updateHierarchyWithExtendedTimeout() {
  console.log('Setting extended timeout and updating hierarchy...\n');
  
  try {
    // First, set a longer timeout for this session
    const { error: timeoutError } = await supabase.rpc('exec_sql', {
      sql: "SET statement_timeout = '10min';"
    });
    
    if (timeoutError) {
      console.log('Could not set timeout via RPC, proceeding with default timeout');
    } else {
      console.log('✓ Extended timeout to 10 minutes');
    }
    
    // Create the update statements
    const updateStatements = [];
    
    // Group updates by niche to minimize SQL statements
    const nicheGroups = {
      // DIY & Crafts
      "UPDATE videos SET topic_niche = 'Woodworking' WHERE topic_cluster_id IN (0,15,51,64,124,153,173,178,185) AND bertopic_version = 'v1_2025-08-01'": 'DIY & Crafts > Woodworking',
      "UPDATE videos SET topic_niche = 'Metalworking' WHERE topic_cluster_id IN (57,167,170) AND bertopic_version = 'v1_2025-08-01'": 'DIY & Crafts > Metalworking',
      "UPDATE videos SET topic_niche = 'Workshop' WHERE topic_cluster_id IN (176,179,191,196,210,214) AND bertopic_version = 'v1_2025-08-01'": 'DIY & Crafts > Workshop',
      
      // Technology
      "UPDATE videos SET topic_niche = 'Programming' WHERE topic_cluster_id IN (59,165,175,183) AND bertopic_version = 'v1_2025-08-01'": 'Technology > Programming',
      "UPDATE videos SET topic_niche = 'Photography & Video' WHERE topic_cluster_id IN (12,41,114,143) AND bertopic_version = 'v1_2025-08-01'": 'Technology > Photography & Video',
      "UPDATE videos SET topic_niche = 'Electronics' WHERE topic_cluster_id IN (112,132,155,159) AND bertopic_version = 'v1_2025-08-01'": 'Technology > Electronics',
      "UPDATE videos SET topic_niche = '3D Printing' WHERE topic_cluster_id IN (22,97) AND bertopic_version = 'v1_2025-08-01'": 'Technology > 3D Printing',
      
      // Business
      "UPDATE videos SET topic_niche = 'Digital Marketing' WHERE topic_cluster_id IN (9,14,34,201) AND bertopic_version = 'v1_2025-08-01'": 'Business > Digital Marketing',
      "UPDATE videos SET topic_niche = 'E-commerce' WHERE topic_cluster_id IN (42,68,158,193) AND bertopic_version = 'v1_2025-08-01'": 'Business > E-commerce',
      
      // Music
      "UPDATE videos SET topic_niche = 'Music Production' WHERE topic_cluster_id IN (29,79,83,89) AND bertopic_version = 'v1_2025-08-01'": 'Music > Music Production',
      "UPDATE videos SET topic_niche = 'Instruments' WHERE topic_cluster_id IN (6,63,85,91,166) AND bertopic_version = 'v1_2025-08-01'": 'Music > Instruments',
      
      // Gaming
      "UPDATE videos SET topic_niche = 'Gameplay' WHERE topic_cluster_id IN (18,20,93,99,109,111,135,163) AND bertopic_version = 'v1_2025-08-01'": 'Gaming > Gameplay',
      
      // Lifestyle
      "UPDATE videos SET topic_niche = 'Home & Organization' WHERE topic_cluster_id IN (2,36,117,160,169) AND bertopic_version = 'v1_2025-08-01'": 'Lifestyle > Home & Organization',
      "UPDATE videos SET topic_niche = 'Alternative Living' WHERE topic_cluster_id IN (4,125,198) AND bertopic_version = 'v1_2025-08-01'": 'Lifestyle > Alternative Living',
    };
    
    // Execute each update
    for (const [sql, description] of Object.entries(nicheGroups)) {
      console.log(`\nUpdating ${description}...`);
      
      const { data, error } = await supabase.rpc('exec_sql', { sql });
      
      if (error) {
        // Fallback: try using raw SQL through a different approach
        console.error(`Failed to execute via RPC: ${error.message}`);
        console.log('Please run this SQL directly in Supabase SQL Editor:');
        console.log(sql);
      } else {
        console.log(`✓ Updated ${description}`);
      }
    }
    
    // Handle outliers
    console.log('\nUpdating outliers...');
    const outlierSql = "UPDATE videos SET topic_domain = 'Outlier', topic_niche = 'Outlier', topic_micro = 'Outlier' WHERE topic_cluster_id = -1 AND bertopic_version = 'v1_2025-08-01'";
    const { error: outlierError } = await supabase.rpc('exec_sql', { sql: outlierSql });
    
    if (outlierError) {
      console.error('Failed to update outliers');
    } else {
      console.log('✓ Updated outliers');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  console.log('\n=== Update Complete ===');
  console.log('Now refresh the materialized view in Supabase SQL Editor:');
  console.log('REFRESH MATERIALIZED VIEW topic_distribution_stats;');
}

// Check if exec_sql RPC exists, if not provide SQL for manual execution
async function checkRPCAndRun() {
  // Try a simple test query
  const { error } = await supabase.rpc('exec_sql', { sql: 'SELECT 1' }).single();
  
  if (error) {
    console.log('The exec_sql RPC function is not available.');
    console.log('Please run the following SQL directly in Supabase SQL Editor:\n');
    
    // Generate all SQL for manual execution
    const allSql = `
-- Set extended timeout for this session
SET statement_timeout = '10min';

-- Update DIY & Crafts niches
UPDATE videos SET topic_niche = 'Woodworking' WHERE topic_cluster_id IN (0,15,51,64,124,153,173,178,185) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Metalworking' WHERE topic_cluster_id IN (57,167,170) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Workshop' WHERE topic_cluster_id IN (176,179,191,196,210,214) AND bertopic_version = 'v1_2025-08-01';

-- Update Technology niches
UPDATE videos SET topic_niche = 'Programming' WHERE topic_cluster_id IN (59,165,175,183) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Photography & Video' WHERE topic_cluster_id IN (12,41,114,143) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Electronics' WHERE topic_cluster_id IN (112,132,155,159) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = '3D Printing' WHERE topic_cluster_id IN (22,97) AND bertopic_version = 'v1_2025-08-01';

-- Update Business niches  
UPDATE videos SET topic_niche = 'Digital Marketing' WHERE topic_cluster_id IN (9,14,34,201) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'E-commerce' WHERE topic_cluster_id IN (42,68,158,193) AND bertopic_version = 'v1_2025-08-01';

-- Update Music niches
UPDATE videos SET topic_niche = 'Music Production' WHERE topic_cluster_id IN (29,79,83,89) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Instruments' WHERE topic_cluster_id IN (6,63,85,91,166) AND bertopic_version = 'v1_2025-08-01';

-- Update Gaming
UPDATE videos SET topic_niche = 'Gameplay' WHERE topic_cluster_id IN (18,20,93,99,109,111,135,163) AND bertopic_version = 'v1_2025-08-01';

-- Update Lifestyle niches
UPDATE videos SET topic_niche = 'Home & Organization' WHERE topic_cluster_id IN (2,36,117,160,169) AND bertopic_version = 'v1_2025-08-01';
UPDATE videos SET topic_niche = 'Alternative Living' WHERE topic_cluster_id IN (4,125,198) AND bertopic_version = 'v1_2025-08-01';

-- Update outliers
UPDATE videos SET topic_domain = 'Outlier', topic_niche = 'Outlier', topic_micro = 'Outlier' WHERE topic_cluster_id = -1 AND bertopic_version = 'v1_2025-08-01';

-- Show summary
SELECT topic_domain, topic_niche, COUNT(*) as video_count
FROM videos
WHERE bertopic_version = 'v1_2025-08-01'
GROUP BY topic_domain, topic_niche
ORDER BY topic_domain, topic_niche;
`;
    
    console.log(allSql);
    
    // Save to file for convenience
    await fs.writeFile('./sql/update-hierarchy-manual.sql', allSql);
    console.log('\n\nSQL also saved to: ./sql/update-hierarchy-manual.sql');
  } else {
    // RPC exists, run the updates
    await updateHierarchyWithExtendedTimeout();
  }
}

checkRPCAndRun().catch(console.error);