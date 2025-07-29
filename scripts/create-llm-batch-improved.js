import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 30000; // Videos per batch file
const MAX_DESCRIPTION_LENGTH = 2000; // Increased to capture YouTube chapters

async function createImprovedBatchFiles() {
  console.log('📝 Creating improved LLM batch files...\n');

  try {
    // Step 1: Get total count of videos needing summaries
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null)
      .not('description', 'is', null)
      .gte('char_length(description)', 50)
      .neq('channel_title', 'Make or Break Shop'); // Exclude our own channel

    console.log(`Found ${totalVideos?.toLocaleString()} videos needing summaries\n`);

    if (!totalVideos || totalVideos === 0) {
      console.log('No videos need summaries!');
      return;
    }

    // Step 2: Create batch directory
    const batchDir = path.join(process.cwd(), 'batch-jobs');
    await fs.mkdir(batchDir, { recursive: true });

    // Step 3: Process in batches with deduplication
    const numBatches = Math.ceil(totalVideos / BATCH_SIZE);
    const processedIds = new Set(); // Track processed video IDs
    let globalVideoCount = 0;

    for (let batchNum = 0; batchNum < numBatches; batchNum++) {
      console.log(`\n📦 Creating batch ${batchNum + 1} of ${numBatches}...`);
      
      const requests = [];
      let offset = 0;
      const targetSize = Math.min(BATCH_SIZE, totalVideos - (batchNum * BATCH_SIZE));
      
      // Keep fetching until we have enough unique videos for this batch
      while (requests.length < targetSize) {
        // Fetch a chunk of videos
        const { data: videos, error } = await supabase
          .from('videos')
          .select('id, title, description')
          .is('llm_summary', null)
          .not('description', 'is', null)
          .gte('char_length(description)', 50)
          .neq('channel_title', 'Make or Break Shop')
          .order('view_count', { ascending: false, nullsFirst: false })
          .range(batchNum * BATCH_SIZE + offset, batchNum * BATCH_SIZE + offset + 999);

        if (error) {
          console.error('Error fetching videos:', error);
          break;
        }

        if (!videos || videos.length === 0) {
          console.log('No more videos available');
          break;
        }

        // Process each video
        for (const video of videos) {
          // Skip if we've already processed this video ID
          if (processedIds.has(video.id)) {
            console.log(`Skipping duplicate: ${video.id}`);
            continue;
          }

          // Skip if we've reached our target for this batch
          if (requests.length >= targetSize) {
            break;
          }

          processedIds.add(video.id);
          globalVideoCount++;

          // Clean and truncate description
          const description = video.description
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, MAX_DESCRIPTION_LENGTH);

          // Escape the description for JSON
          const escapedDescription = description
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');

          const request = {
            custom_id: video.id, // Use video ID as custom_id
            method: "POST",
            url: "/v1/chat/completions",
            body: {
              model: "gpt-4o-mini",
              messages: [
                {
                  role: "system",
                  content: "You extract and summarize the core content from YouTube video descriptions."
                },
                {
                  role: "user",
                  content: `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase.

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.

Description:
${escapedDescription}`
                }
              ],
              max_tokens: 100,
              temperature: 0.3
            }
          };

          requests.push(request);
        }

        offset += 1000;
        
        // Show progress
        if (requests.length % 5000 === 0) {
          console.log(`  Added ${requests.length}/${targetSize} videos to batch ${batchNum + 1}`);
        }
      }

      if (requests.length === 0) {
        console.log('No videos to process in this batch');
        continue;
      }

      // Write batch file
      const fileName = `llm-summaries-batch-${batchNum + 1}.jsonl`;
      const filePath = path.join(batchDir, fileName);
      
      const fileContent = requests.map(req => JSON.stringify(req)).join('\n');
      await fs.writeFile(filePath, fileContent);

      // Calculate cost
      const estimatedTokens = requests.length * 150; // ~150 tokens per request
      const costPer1M = 0.075; // GPT-4o-mini pricing
      const estimatedCost = (estimatedTokens / 1000000) * costPer1M;

      console.log(`✅ Created ${fileName}`);
      console.log(`   Videos: ${requests.length}`);
      console.log(`   Estimated cost: $${estimatedCost.toFixed(2)}`);
      console.log(`   File size: ${(fileContent.length / 1024 / 1024).toFixed(2)} MB`);
    }

    // Summary
    console.log('\n📊 BATCH CREATION COMPLETE');
    console.log(`Total unique videos processed: ${globalVideoCount.toLocaleString()}`);
    console.log(`Total duplicates skipped: ${(processedIds.size - globalVideoCount).toLocaleString()}`);
    console.log(`\nBatch files saved to: ${batchDir}`);
    
    // Verify no duplicates
    console.log(`\n✅ Verification: ${processedIds.size} unique video IDs across all batches`);

  } catch (error) {
    console.error('Error creating batch files:', error);
  }
}

// Add standalone verification function
async function verifyBatchFiles() {
  console.log('\n🔍 Verifying batch files for duplicates...\n');
  
  const batchDir = path.join(process.cwd(), 'batch-jobs');
  const files = await fs.readdir(batchDir);
  const jsonlFiles = files.filter(f => f.startsWith('llm-summaries-batch-') && f.endsWith('.jsonl'));
  
  const allIds = new Set();
  const duplicates = [];
  
  for (const file of jsonlFiles) {
    const content = await fs.readFile(path.join(batchDir, file), 'utf-8');
    const lines = content.trim().split('\n');
    
    console.log(`Checking ${file}: ${lines.length} requests`);
    
    for (let i = 0; i < lines.length; i++) {
      try {
        const request = JSON.parse(lines[i]);
        if (allIds.has(request.custom_id)) {
          duplicates.push({
            id: request.custom_id,
            file: file,
            line: i + 1
          });
        }
        allIds.add(request.custom_id);
      } catch (e) {
        console.error(`Error parsing line ${i + 1} in ${file}`);
      }
    }
  }
  
  console.log(`\nTotal unique IDs: ${allIds.size}`);
  console.log(`Duplicates found: ${duplicates.length}`);
  
  if (duplicates.length > 0) {
    console.log('\nFirst 10 duplicates:');
    duplicates.slice(0, 10).forEach(d => {
      console.log(`  ID: ${d.id} in ${d.file} at line ${d.line}`);
    });
  }
}

// Run based on command line argument
const command = process.argv[2];
if (command === 'verify') {
  verifyBatchFiles().catch(console.error);
} else {
  createImprovedBatchFiles().catch(console.error);
}