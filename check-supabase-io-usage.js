import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

console.log('🔍 Checking Supabase I/O Usage and Limits\n');

console.log('📊 Where to find your Supabase I/O limits:\n');

console.log('1. Supabase Dashboard -> Settings -> Usage');
console.log('   URL: https://supabase.com/dashboard/project/_/settings/usage');
console.log('   - Shows current IOPS usage');
console.log('   - Database size');
console.log('   - Bandwidth usage');
console.log('   - Active connections\n');

console.log('2. Supabase Dashboard -> Reports -> Database');
console.log('   URL: https://supabase.com/dashboard/project/_/reports/database');
console.log('   - Real-time IOPS graph');
console.log('   - Database performance metrics');
console.log('   - Query performance stats\n');

console.log('3. Supabase Dashboard -> Settings -> Billing');
console.log('   URL: https://supabase.com/dashboard/project/_/settings/billing');
console.log('   - Your current plan details');
console.log('   - IOPS limits for your plan');
console.log('   - Overage charges if applicable\n');

console.log('4. Database Metrics (Monitoring)');
console.log('   URL: https://supabase.com/dashboard/project/_/reports/database');
console.log('   - IOPS usage over time');
console.log('   - Peak IOPS');
console.log('   - Read vs Write IOPS breakdown\n');

console.log('⚠️  Common IOPS Warning Triggers:');
console.log('   - Exceeding 3,000 IOPS (Free/Pro baseline)');
console.log('   - Sustained high IOPS for extended periods');
console.log('   - Burst IOPS beyond plan limits\n');

console.log('💡 To reduce IOPS:');
console.log('   - Batch database operations');
console.log('   - Use connection pooling');
console.log('   - Add indexes for frequent queries');
console.log('   - Cache frequently accessed data');
console.log('   - Use materialized views for complex queries\n');

// Get your project URL to make it easy
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (projectUrl) {
  const projectRef = projectUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (projectRef) {
    console.log(`🔗 Your project dashboard links:`);
    console.log(`   Usage: https://supabase.com/dashboard/project/${projectRef}/settings/usage`);
    console.log(`   Database: https://supabase.com/dashboard/project/${projectRef}/reports/database`);
    console.log(`   Billing: https://supabase.com/dashboard/project/${projectRef}/settings/billing`);
  }
}