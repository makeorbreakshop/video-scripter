import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchEmbeddings() {
  console.log('🚀 Starting simple embedding fetch...');
  
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
  
  // Get video IDs
  console.log('Getting video IDs from Supabase...');
  let allIds = [];
  let offset = 0;
  
  while (true) {
    const { data, error } = await supabase
      .from('videos')
      .select('id')
      .order('id')
      .range(offset, offset + 999);
    
    if (!data || data.length === 0) break;
    allIds = allIds.concat(data.map(v => v.id));
    offset += 1000;
    
    if (offset % 10000 === 0) {
      console.log(`  Loaded ${allIds.length} IDs...`);
    }
  }
  
  console.log(`Total IDs: ${allIds.length}`);
  
  // Fetch from Pinecone in small batches, save frequently
  const SAVE_EVERY = 10000;  // Save every 10K
  let embeddings = [];
  let fileNumber = 1;
  let totalFound = 0;
  
  for (let i = 0; i < allIds.length; i += 100) {
    const batchIds = allIds.slice(i, i + 100);
    
    try {
      const response = await index.fetch(batchIds);
      
      for (const id of batchIds) {
        if (response.records && response.records[id]) {
          embeddings.push({
            id: id,
            values: response.records[id].values,
            metadata: response.records[id].metadata || {}
          });
          totalFound++;
        }
      }
    } catch (err) {
      console.log(`Error at batch ${i/100}: ${err.message}`);
    }
    
    // Save when we hit the limit
    if (embeddings.length >= SAVE_EVERY) {
      const filename = `embeddings-part-${fileNumber}.json`;
      console.log(`Saving ${filename} with ${embeddings.length} embeddings...`);
      
      fs.writeFileSync(filename, JSON.stringify({
        part: fileNumber,
        count: embeddings.length,
        embeddings: embeddings
      }));
      
      embeddings = [];  // Clear memory
      fileNumber++;
    }
    
    // Progress
    if (i % 10000 === 0) {
      console.log(`Progress: ${i}/${allIds.length} (${totalFound} found)`);
    }
  }
  
  // Save any remaining
  if (embeddings.length > 0) {
    const filename = `embeddings-part-${fileNumber}.json`;
    console.log(`Saving final ${filename} with ${embeddings.length} embeddings...`);
    
    fs.writeFileSync(filename, JSON.stringify({
      part: fileNumber,
      count: embeddings.length,
      embeddings: embeddings
    }));
  }
  
  console.log(`\nDone! Total embeddings found: ${totalFound}`);
  console.log(`Saved in ${fileNumber} files`);
}

fetchEmbeddings().catch(console.error);