import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function enrichEmbeddings() {
  console.log('Enriching embeddings with titles from database...\n');
  
  // Process each embedding file
  for (let fileNum = 1; fileNum <= 17; fileNum++) {
    const filename = `embeddings-part-${fileNum}.json`;
    console.log(`Processing ${filename}...`);
    
    // Load file
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const videoIds = data.embeddings.map(e => e.id);
    
    // Fetch titles from database in batches
    const batchSize = 100;
    const titleMap = {};
    
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batchIds = videoIds.slice(i, i + batchSize);
      
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title, channel_id, channel_title, published_at, view_count')
        .in('id', batchIds);
      
      if (error) {
        console.error(`Error fetching batch: ${error.message}`);
        continue;
      }
      
      // Build title map
      videos.forEach(v => {
        titleMap[v.id] = {
          title: v.title,
          channel_id: v.channel_id,
          channel_title: v.channel_title,
          published_at: v.published_at,
          view_count: v.view_count
        };
      });
    }
    
    // Enrich embeddings
    let enrichedCount = 0;
    data.embeddings.forEach(emb => {
      if (titleMap[emb.id]) {
        emb.metadata = {
          ...emb.metadata,
          ...titleMap[emb.id]
        };
        enrichedCount++;
      }
    });
    
    // Save enriched file
    const enrichedFilename = filename.replace('.json', '-enriched.json');
    fs.writeFileSync(enrichedFilename, JSON.stringify(data, null, 2));
    
    console.log(`  Enriched ${enrichedCount}/${data.embeddings.length} embeddings`);
    console.log(`  Saved to ${enrichedFilename}\n`);
  }
  
  console.log('Done! Use the -enriched.json files for clustering.');
}

enrichEmbeddings().catch(console.error);