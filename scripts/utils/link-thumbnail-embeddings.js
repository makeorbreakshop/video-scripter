import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function linkThumbnailEmbeddings() {
  console.log('🔗 Linking thumbnail embeddings from Pinecone to Supabase...');
  
  try {
    // Connect to Pinecone thumbnail index
    const index = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME);
    
    // Get index stats to see how many vectors we have
    const stats = await index.describeIndexStats();
    console.log(`📊 Pinecone thumbnail index stats:`, stats);
    
    // Process in batches due to Supabase 1000 row limit
    let offset = 0;
    const batchSize = 1000;
    let totalLinked = 0;
    let totalNotFound = 0;
    let totalProcessed = 0;
    
    while (true) {
      // Get batch of videos that might have embeddings but aren't tracked
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id')
        .is('thumbnail_embedding_version', null)
        .not('pinecone_embedding_version', 'is', null) // Only check videos we've processed
        .range(offset, offset + batchSize - 1);
      
      if (error) {
        console.error('Error fetching videos:', error);
        break;
      }
      
      if (!videos || videos.length === 0) {
        console.log('No more videos to process');
        break;
      }
      
      console.log(`\nProcessing batch ${Math.floor(offset / batchSize) + 1}: ${videos.length} videos`);
      
      let linked = 0;
      let notFound = 0;
    
    // Check each video in Pinecone
    for (const video of videos) {
      try {
        // Query by ID to see if vector exists
        const queryResult = await index.query({
          id: video.id,
          topK: 1,
          includeMetadata: true
        });
        
        if (queryResult.matches && queryResult.matches.length > 0) {
          // Vector exists in Pinecone with matching ID
          if (linked === 0) {
            console.log(`  First match example: Video ${video.id} found in Pinecone`);
          }
          
          // Update Supabase for this exact video ID
          const { error: updateError } = await supabase
            .from('videos')
            .update({ 
              thumbnail_embedding_version: 'v1',
              embedding_thumbnail_synced: true 
            })
            .eq('id', video.id);
          
          if (!updateError) {
            linked++;
            if (linked % 100 === 0) {
              console.log(`  ✅ Linked ${linked} thumbnail embeddings...`);
            }
          } else {
            console.error(`Failed to update video ${video.id}:`, updateError);
          }
        } else {
          notFound++;
        }
      } catch (err) {
        // If we can't query by ID, try fetch
        try {
          const fetchResult = await index.fetch([video.id]);
          if (fetchResult.records && fetchResult.records[video.id]) {
            // Vector exists
            const { error: updateError } = await supabase
              .from('videos')
              .update({ 
                thumbnail_embedding_version: 'v1',
                embedding_thumbnail_synced: true 
              })
              .eq('id', video.id);
            
            if (!updateError) {
              linked++;
              if (linked % 100 === 0) {
                console.log(`  ✅ Linked ${linked} thumbnail embeddings...`);
              }
            }
          } else {
            notFound++;
          }
        } catch (fetchErr) {
          // Video doesn't have thumbnail embedding
          notFound++;
        }
      }
    }
    
    totalLinked += linked;
    totalNotFound += notFound;
    totalProcessed += videos.length;
    
    console.log(`  Batch complete: Linked ${linked}, Not found ${notFound}`);
    
    // Move to next batch
    offset += batchSize;
    
    // Optional: Stop after a certain number of batches to avoid running too long
    if (offset >= 10000) { // Process up to 10,000 videos
      console.log('Reached processing limit of 10,000 videos');
      break;
    }
  }
  
  console.log(`
✅ Linking complete:
   • Total linked: ${totalLinked} videos
   • Total not found in Pinecone: ${totalNotFound} videos
   • Total processed: ${totalProcessed} videos`);
    
    // Show sample of linked videos
    const { data: sample } = await supabase
      .from('videos')
      .select('id, title, thumbnail_embedding_version, channel_name')
      .not('thumbnail_embedding_version', 'is', null)
      .limit(5);
    
    console.log('\n📊 Sample of linked videos:');
    sample?.forEach(v => {
      console.log(`  ${v.title} (${v.channel_name})`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
}

linkThumbnailEmbeddings().catch(console.error);