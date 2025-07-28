import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// The refined prompt that performed best in testing
const ACTION_FIRST_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

interface BatchRequest {
  custom_id: string;
  method: string;
  url: string;
  body: {
    model: string;
    messages: Array<{
      role: string;
      content: string;
    }>;
    temperature: number;
    max_tokens: number;
  };
}

export class LLMSummaryBatchProcessor {
  private batchDir = './batch_jobs';
  private maxBatchSize = 30000; // Using 30K for safety (OpenAI limit is 50K)
  private costPerMillion = 0.15; // GPT-4o-mini input cost
  
  async prepareBatches(limit?: number) {
    console.log('🚀 Preparing batches for LLM summary generation...\n');
    
    // Create batch directory
    await fs.mkdir(this.batchDir, { recursive: true });
    
    // Get videos without summaries
    const query = supabase
      .from('videos')
      .select('id, title, description, channel_name')
      .is('llm_summary', null)
      .not('description', 'is', null)
      .gte('char_length(description)', 50)
      .order('created_at', { ascending: false });
    
    if (limit) {
      query.limit(limit);
    }
    
    const { data: videos, error } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }
    
    if (!videos || videos.length === 0) {
      console.log('No videos need summary generation!');
      return;
    }
    
    console.log(`Found ${videos.length} videos needing summaries\n`);
    
    // Split into batches
    const batches: BatchRequest[][] = [];
    for (let i = 0; i < videos.length; i += this.maxBatchSize) {
      batches.push(
        videos.slice(i, i + this.maxBatchSize).map(video => ({
          custom_id: video.id,
          method: 'POST',
          url: '/v1/chat/completions',
          body: {
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: ACTION_FIRST_PROMPT
              },
              {
                role: 'user',
                content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 1000) || 'No description'}`
              }
            ],
            temperature: 0.3,
            max_tokens: 100
          }
        }))
      );
    }
    
    // Save batch files
    const batchFiles: string[] = [];
    for (let i = 0; i < batches.length; i++) {
      const filename = `batch_${Date.now()}_${i}.jsonl`;
      const filepath = path.join(this.batchDir, filename);
      
      const jsonlContent = batches[i]
        .map(req => JSON.stringify(req))
        .join('\n');
      
      await fs.writeFile(filepath, jsonlContent);
      batchFiles.push(filename);
      
      console.log(`📄 Created batch file: ${filename} (${batches[i].length} videos)`);
    }
    
    // Calculate estimated cost
    const estimatedTokens = videos.length * 200; // ~200 tokens per request
    const estimatedCost = (estimatedTokens / 1_000_000) * this.costPerMillion;
    const batchCost = estimatedCost * 0.5; // 50% discount for batch API
    
    console.log('\n💰 Cost Estimate:');
    console.log(`  Standard API: $${estimatedCost.toFixed(2)}`);
    console.log(`  Batch API (50% off): $${batchCost.toFixed(2)}`);
    console.log(`  Processing time: ~24 hours`);
    
    return {
      batchFiles,
      videoCount: videos.length,
      estimatedCost: batchCost
    };
  }
  
  async submitBatches(batchFiles: string[]) {
    console.log('\n📤 Submitting batches to OpenAI...\n');
    
    const batchIds: string[] = [];
    
    for (const filename of batchFiles) {
      const filepath = path.join(this.batchDir, filename);
      
      // Upload file
      const file = await openai.files.create({
        file: await fs.readFile(filepath),
        purpose: 'batch'
      });
      
      // Create batch
      const batch = await openai.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h'
      });
      
      batchIds.push(batch.id);
      console.log(`✅ Submitted batch: ${batch.id} (${filename})`);
      
      // Save batch ID for tracking
      await fs.writeFile(
        path.join(this.batchDir, `${filename}.batch_id`),
        batch.id
      );
    }
    
    return batchIds;
  }
  
  async checkBatchStatus(batchId: string) {
    const batch = await openai.batches.retrieve(batchId);
    return {
      id: batch.id,
      status: batch.status,
      progress: `${batch.request_counts?.completed || 0}/${batch.request_counts?.total || 0}`,
      errors: batch.request_counts?.failed || 0
    };
  }
  
  async processBatchResults(batchId: string) {
    console.log(`\n📥 Processing results for batch ${batchId}...`);
    
    const batch = await openai.batches.retrieve(batchId);
    
    if (batch.status !== 'completed') {
      throw new Error(`Batch ${batchId} is not completed. Status: ${batch.status}`);
    }
    
    if (!batch.output_file_id) {
      throw new Error(`Batch ${batchId} has no output file`);
    }
    
    // Download results
    const fileResponse = await openai.files.content(batch.output_file_id);
    const fileContent = await fileResponse.text();
    
    // Parse results
    const results = fileContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
    
    // Update database
    let successCount = 0;
    let errorCount = 0;
    
    for (const result of results) {
      if (result.response?.status_code === 200) {
        const videoId = result.custom_id;
        const summary = result.response.body.choices[0].message.content.trim();
        
        const { error } = await supabase
          .from('videos')
          .update({
            llm_summary: summary,
            llm_summary_generated_at: new Date().toISOString(),
            llm_summary_model: 'gpt-4o-mini'
          })
          .eq('id', videoId);
        
        if (error) {
          console.error(`Failed to update video ${videoId}:`, error);
          errorCount++;
        } else {
          successCount++;
        }
      } else {
        errorCount++;
      }
    }
    
    console.log(`✅ Processed ${successCount} summaries successfully`);
    console.log(`❌ ${errorCount} errors`);
    
    return { successCount, errorCount };
  }
  
  async cleanupBatchFiles() {
    const files = await fs.readdir(this.batchDir);
    for (const file of files) {
      if (file.endsWith('.jsonl') || file.endsWith('.batch_id')) {
        await fs.unlink(path.join(this.batchDir, file));
      }
    }
    console.log('🧹 Cleaned up batch files');
  }
}