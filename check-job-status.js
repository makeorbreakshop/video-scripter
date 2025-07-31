// Check job status
import dotenv from 'dotenv';
dotenv.config();

async function checkJobStatus(jobId) {
  console.log(`Checking job status for: ${jobId}\n`);
  
  const maxAttempts = 30; // Check for 30 seconds
  let attempt = 0;
  
  while (attempt < maxAttempts) {
    const response = await fetch(`http://localhost:3000/api/video-import/job-status/${jobId}`);
    const status = await response.json();
    
    console.log(`Attempt ${attempt + 1}: ${status.status}`);
    
    if (status.status === 'completed' || status.status === 'failed') {
      console.log('\nFinal status:', JSON.stringify(status, null, 2));
      
      if (status.status === 'completed' && status.processedVideoIds?.length > 0) {
        // Check database for the video
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        const videoId = status.processedVideoIds[0];
        const { data: video } = await supabase
          .from('videos')
          .select('id, title, llm_summary, llm_summary_embedding_synced')
          .eq('id', videoId)
          .single();
          
        if (video) {
          console.log('\n📊 Database check:');
          console.log(`- Video: ${video.title}`);
          console.log(`- Has summary: ${video.llm_summary ? 'Yes' : 'No'}`);
          console.log(`- Summary synced to Pinecone: ${video.llm_summary_embedding_synced ? 'Yes' : 'No'}`);
        }
      }
      
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempt++;
  }
}

// Use the job ID from the previous test
const jobId = 'c3e8a65f-8c9e-4331-85bd-3e167309dda6';
checkJobStatus(jobId).catch(console.error);