import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSupabaseLimits() {
  console.log('🔍 Checking Supabase Performance & Limits\n');

  // Check current database size
  const { data: dbSize } = await supabase.rpc('pg_database_size', { dbname: 'postgres' });
  console.log(`📊 Database Size: ${(dbSize / 1024 / 1024 / 1024).toFixed(2)} GB`);

  // Check connection count
  const { data: connections } = await supabase
    .from('pg_stat_activity')
    .select('*', { count: 'exact', head: true });
  
  console.log(`🔌 Active Connections: ${connections || 'Unable to query'}`);

  // Check table sizes
  const { data: tableSizes } = await supabase.rpc('get_table_sizes');
  if (tableSizes) {
    console.log('\n📋 Largest Tables:');
    tableSizes.slice(0, 5).forEach(t => {
      console.log(`  - ${t.table_name}: ${t.size}`);
    });
  }

  console.log('\n⚡ Performance Guidelines:');
  console.log('  - Free Plan: 500 RPS (requests per second)');
  console.log('  - Pro Plan: No hard RPS limit, based on compute');
  console.log('  - Recommended: Batch operations, connection pooling');
  console.log('  - IOPS: Monitor via Supabase dashboard metrics');
}

// Create RPC function to get table sizes if it doesn't exist
const createTableSizeFunction = `
CREATE OR REPLACE FUNCTION get_table_sizes()
RETURNS TABLE(table_name text, size text)
LANGUAGE sql
AS $$
  SELECT 
    schemaname||'.'||tablename AS table_name,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
  LIMIT 10;
$$;
`;

checkSupabaseLimits().catch(console.error);