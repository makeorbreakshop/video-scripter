import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkQuotaStatus() {
  try {
    const { data, error } = await supabase.rpc('get_quota_status');
    
    if (error) {
      console.error('Error:', error);
      return;
    }
    
    console.log('📊 YOUTUBE QUOTA STATUS:\n');
    console.log(`Current usage: ${data.current_usage.toLocaleString()} / ${data.daily_limit.toLocaleString()}`);
    console.log(`Percentage used: ${data.percentage_used.toFixed(1)}%`);
    console.log(`Remaining quota: ${data.remaining_quota.toLocaleString()}`);
    console.log(`Reset time: ${data.reset_time}`);
    
    // Check recent calls
    const { data: recentCalls } = await supabase
      .from('youtube_quota_calls')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(10);
      
    console.log('\n📞 RECENT API CALLS:');
    recentCalls?.forEach(call => {
      const time = new Date(call.timestamp).toLocaleTimeString();
      console.log(`${time}: ${call.method} - ${call.cost} units (${call.description})`);
    });
    
  } catch (error) {
    console.error('Error checking quota:', error);
  }
}

checkQuotaStatus().catch(console.error);