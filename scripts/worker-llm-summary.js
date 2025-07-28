#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// The action-first prompt
const ACTION_FIRST_PROMPT = `Analyze this YouTube description and extract only the core content, ignoring all promotional material.

Describe what happens or what is taught in 1-2 sentences. Start with an action verb or noun phrase. Never mention "video", "tutorial", or similar meta-references.

Focus purely on the content itself - the techniques, materials, concepts, and outcomes.`;

class LLMSummaryWorker {
  constructor() {
    this.batchSize = 10;
    this.processedCount = 0;
    this.errorCount = 0;
    this.isRunning = false;
  }

  async run() {
    console.log('🚀 LLM Summary Worker started');
    console.log(`   Batch size: ${this.batchSize}`);
    console.log(`   Model: gpt-4o-mini`);
    console.log('   Press Ctrl+C to stop\n');

    this.isRunning = true;

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down gracefully...');
      this.isRunning = false;
    });

    while (this.isRunning) {
      try {
        await this.processBatch();
        
        // Check if there are more videos
        const { count } = await supabase
          .from('videos')
          .select('*', { count: 'exact', head: true })
          .is('llm_summary', null)
          .not('description', 'is', null)
          .gte('char_length(description)', 50);

        if (count === 0) {
          console.log('\n✅ All videos have been processed!');
          break;
        }

        // Short delay between batches
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error('❌ Worker error:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    this.printSummary();
  }

  async processBatch() {
    // Get videos needing summaries
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('llm_summary', null)
      .not('description', 'is', null)
      .gte('char_length(description)', 50)
      .order('view_count', { ascending: false }) // Process popular videos first
      .limit(this.batchSize);

    if (error) {
      console.error('Database error:', error);
      return;
    }

    if (!videos || videos.length === 0) {
      return;
    }

    console.log(`\n📦 Processing batch of ${videos.length} videos...`);

    // Process videos in parallel
    const results = await Promise.all(
      videos.map(video => this.generateSummary(video))
    );

    // Update statistics
    const successful = results.filter(r => r.success).length;
    this.processedCount += successful;
    this.errorCount += results.filter(r => !r.success).length;

    console.log(`✅ Batch complete: ${successful}/${videos.length} successful`);
    console.log(`📊 Total processed: ${this.processedCount} | Errors: ${this.errorCount}`);

    // Show a sample of generated summaries
    const sample = results.find(r => r.success);
    if (sample) {
      console.log(`\n📝 Sample summary:`);
      console.log(`   Video: "${sample.video.title}"`);
      console.log(`   Summary: "${sample.summary}"`);
    }
  }

  async generateSummary(video) {
    try {
      const response = await openai.chat.completions.create({
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
      });

      const summary = response.choices[0].message.content.trim();

      // Update database
      const { error } = await supabase
        .from('videos')
        .update({
          llm_summary: summary,
          llm_summary_generated_at: new Date().toISOString(),
          llm_summary_model: 'gpt-4o-mini'
        })
        .eq('id', video.id);

      if (error) {
        throw error;
      }

      return { success: true, video, summary };

    } catch (error) {
      console.error(`❌ Failed to process ${video.id}:`, error.message);
      return { success: false, video, error: error.message };
    }
  }

  printSummary() {
    console.log('\n📊 WORKER SUMMARY');
    console.log('═══════════════════════════════');
    console.log(`✅ Summaries generated: ${this.processedCount}`);
    console.log(`❌ Errors: ${this.errorCount}`);
    console.log(`📈 Success rate: ${((this.processedCount / (this.processedCount + this.errorCount)) * 100).toFixed(1)}%`);
    
    // Calculate estimated cost
    const tokensPerRequest = 200; // Rough estimate
    const totalTokens = this.processedCount * tokensPerRequest;
    const cost = (totalTokens / 1_000_000) * 0.15; // $0.15 per 1M tokens
    console.log(`💰 Estimated cost: $${cost.toFixed(2)}`);
  }
}

// Run the worker
const worker = new LLMSummaryWorker();
worker.run().catch(console.error);