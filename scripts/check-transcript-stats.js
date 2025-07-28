import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTranscriptStats() {
  console.log('Checking transcript statistics...\n');

  try {
    // Query 1: Total videos - use count properly
    const { count: totalCount, error: error1 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error1) throw error1;
    console.log(`1. Total videos: ${totalCount || 0}`);

    // Query 2: Videos with transcripts - get all transcript chunks and count unique video IDs
    const { data: chunks, error: error2 } = await supabase
      .from('chunks')
      .select('video_id')
      .eq('content_type', 'transcript');
    
    if (error2) throw error2;
    
    const uniqueVideoIds = [...new Set(chunks?.map(c => c.video_id) || [])];
    console.log(`2. Videos with transcripts: ${uniqueVideoIds.length}`);
    
    // Query 3: Videos without transcripts
    console.log(`3. Videos without transcripts: ${(totalCount || 0) - uniqueVideoIds.length}`);

    // Additional useful stats
    console.log('\nAdditional statistics:');
    
    // Get recent videos without transcripts
    const { data: recentWithoutTranscripts, error: error3 } = await supabase
      .from('videos')
      .select('id, title, channel_title, published_at')
      .order('published_at', { ascending: false })
      .limit(5);
    
    if (!error3 && recentWithoutTranscripts) {
      // Check which ones have transcripts
      const videoIds = recentWithoutTranscripts.map(v => v.id);
      const { data: transcriptChunks, error: error4 } = await supabase
        .from('chunks')
        .select('video_id')
        .in('video_id', videoIds)
        .eq('content_type', 'transcript');
      
      if (!error4) {
        const videosWithTranscriptIds = new Set(transcriptChunks?.map(c => c.video_id) || []);
        const withoutTranscripts = recentWithoutTranscripts.filter(v => !videosWithTranscriptIds.has(v.id));
        
        if (withoutTranscripts.length > 0) {
          console.log('\nRecent videos without transcripts:');
          withoutTranscripts.forEach(v => {
            console.log(`- ${v.title} (${v.channel_title}) - Published: ${new Date(v.published_at).toLocaleDateString()}`);
          });
        }
      }
    }

    // Get transcript chunk statistics
    const { count: transcriptChunkCount, error: error5 } = await supabase
      .from('chunks')
      .select('*', { count: 'exact', head: true })
      .eq('content_type', 'transcript');
    
    if (!error5) {
      console.log(`\nTotal transcript chunks: ${transcriptChunkCount || 0}`);
    }

  } catch (error) {
    console.error('Error:', error);
  }

  process.exit(0);
}

checkTranscriptStats();