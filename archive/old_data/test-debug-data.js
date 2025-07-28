import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testDebugData() {
  console.log('Testing debug data query...');
  
  // Test the exact query from the debug page
  const { data: videos, error } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      published_at,
      view_snapshots (
        days_since_published,
        view_count,
        snapshot_date
      )
    `)
    .eq('channel_name', '3D Printing Nerd')
    .order('published_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Query error:', error);
    return;
  }

  console.log(`Found ${videos?.length} videos`);
  
  if (videos && videos.length > 0) {
    videos.forEach((v, i) => {
      console.log(`\nVideo ${i}: ${v.title}`);
      console.log(`Published: ${v.published_at}`);
      console.log(`Snapshots: ${v.view_snapshots?.length || 0}`);
      
      if (v.view_snapshots && v.view_snapshots.length > 0) {
        v.view_snapshots.forEach((s, j) => {
          console.log(`  Snapshot ${j}: Day ${s.days_since_published}, ${s.view_count} views, ${s.snapshot_date}`);
        });
      }
    });
    
    // Create data points like the app does
    const allPoints = [];
    videos.forEach(v => {
      if (v.view_snapshots && v.view_snapshots.length > 0) {
        v.view_snapshots.forEach(s => {
          allPoints.push({
            days: s.days_since_published,
            views: s.view_count,
            video_id: v.id,
            title: v.title
          });
        });
      }
    });
    
    console.log(`\nTotal data points: ${allPoints.length}`);
    console.log('First 5 data points:');
    allPoints.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i}: Day ${p.days}, ${p.views} views, "${p.title}"`);
    });
  }
}

testDebugData().catch(console.error);