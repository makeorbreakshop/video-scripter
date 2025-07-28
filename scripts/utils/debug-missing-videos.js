/**
 * Debug script to find missing videos between YouTube channel and database
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function debugMissingVideos() {
  try {
    console.log('🔍 Checking for missing videos...');
    
    // Get all videos from database
    const { data: dbVideos, error } = await supabase
      .from('videos')
      .select('id, title, published_at')
      .eq('channel_id', 'Make or Break Shop')
      .order('published_at', { ascending: false });
    
    if (error) {
      console.error('Database error:', error);
      return;
    }
    
    console.log(`📊 Found ${dbVideos.length} videos in database`);
    console.log('\n📅 Most recent 5 videos in database:');
    dbVideos.slice(0, 5).forEach((video, i) => {
      console.log(`${i + 1}. ${video.title} (${video.published_at})`);
    });
    
    console.log('\n🔍 Database has videos from:', 
      new Date(dbVideos[0].published_at).toLocaleDateString(), 
      'to', 
      new Date(dbVideos[dbVideos.length - 1].published_at).toLocaleDateString()
    );
    
    console.log('\n⚠️  Missing videos likely exist between April 25, 2025 and today (June 30, 2025)');
    console.log('   The channel sync found 215 videos but imported 0, suggesting a comparison bug.');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

debugMissingVideos();