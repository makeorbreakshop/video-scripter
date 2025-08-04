#!/usr/bin/env node

/**
 * Get the database connection URL from Supabase
 * This helps you find the correct connection string to add to your .env
 */

console.log('📝 To get your direct database connection URL:\n');

console.log('1. Go to: https://supabase.com/dashboard/project/mhzwrynnfphlxqcqytrj/settings/database');
console.log('');
console.log('2. Look for "Connection string" section');
console.log('');
console.log('3. Copy the URI (it will look like this):');
console.log('   postgresql://postgres.mhzwrynnfphlxqcqytrj:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres');
console.log('');
console.log('4. Replace [YOUR-PASSWORD] with your actual database password');
console.log('');
console.log('5. Update your .env file:');
console.log('   DATABASE_URL=postgresql://postgres.mhzwrynnfphlxqcqytrj:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres');
console.log('');
console.log('6. Then run:');
console.log('   node scripts/direct-db-update.js');
console.log('');
console.log('🔐 Your database password is the same one you use for direct database access in Supabase Dashboard.');
console.log('   If you forgot it, you can reset it in Settings > Database > Database Password');