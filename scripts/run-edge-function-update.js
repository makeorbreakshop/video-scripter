#!/usr/bin/env node

/**
 * Client script to call the Edge Function for hierarchy updates
 * Handles the full mapping and monitors progress
 */

import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadFullMapping() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  return data.topics;
}

async function callEdgeFunction() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }

  console.log('🚀 Starting BERTopic hierarchy update via Edge Function...\n');

  // Load the full mapping
  const fullMapping = await loadFullMapping();
  console.log(`📊 Loaded mapping for ${Object.keys(fullMapping).length} clusters\n`);

  // Call the Edge Function
  const functionUrl = `${supabaseUrl}/functions/v1/update-topic-hierarchy`;
  
  try {
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({
        fullMapping,
        batchSize: 20, // Process 20 clusters at a time
        startFrom: 0
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Function error: ${error}`);
    }

    // Handle streaming response
    const reader = response.body;
    const decoder = new TextDecoder();
    let buffer = '';

    console.log('📡 Receiving updates...\n');

    for await (const chunk of reader) {
      buffer += decoder.decode(chunk, { stream: true });
      
      // Process complete messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            switch (data.status) {
              case 'starting':
                console.log(`✅ Started processing ${data.totalClusters} clusters`);
                break;
              case 'processing':
                console.log(`⏳ Batch ${data.batch}: ${data.progress} clusters processed`);
                break;
              case 'updated':
                console.log(`  ✅ Cluster ${data.clusterId}: ${data.count} videos updated`);
                break;
              case 'error':
                console.error(`  ❌ Cluster ${data.clusterId}: ${data.error}`);
                break;
              case 'completed':
                console.log('\n' + '='.repeat(50));
                console.log('✅ Update completed!');
                console.log(`📊 Total videos updated: ${data.totalUpdated}`);
                console.log(`❌ Errors: ${data.errors}`);
                console.log('='.repeat(50));
                break;
              case 'fatal_error':
                console.error(`\n❌ Fatal error: ${data.error}`);
                break;
            }
          } catch (e) {
            // Ignore parsing errors for incomplete messages
          }
        }
      }
    }

  } catch (error) {
    console.error('❌ Error calling Edge Function:', error.message);
    console.log('\n💡 Make sure the Edge Function is deployed:');
    console.log('   npx supabase functions deploy update-topic-hierarchy');
  }
}

// Main execution
async function main() {
  try {
    await callEdgeFunction();
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();