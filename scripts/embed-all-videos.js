#!/usr/bin/env node

/**
 * Script to embed ALL unembedded videos in the database
 * This script automatically processes videos in batches until all are embedded
 */

require('dotenv').config();

async function embedAllVideos() {
  console.log('🚀 Starting automatic embedding of all unembedded videos...');
  
  try {
    const response = await fetch('http://localhost:3000/api/embeddings/titles/embed-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }

    const results = await response.json();
    
    console.log('\n🎯 EMBEDDING COMPLETE!');
    console.log(`📊 Results:`);
    console.log(`   - Videos processed: ${results.processed}`);
    console.log(`   - Successfully embedded: ${results.successful}`);
    console.log(`   - Failed: ${results.failed}`);
    console.log(`   - Batch ID: ${results.batch_id}`);
    
    if (results.errors && results.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered:`);
      results.errors.slice(0, 10).forEach(error => console.log(`   - ${error}`));
      if (results.errors.length > 10) {
        console.log(`   - ... and ${results.errors.length - 10} more errors`);
      }
    }
    
    if (results.successful === 0 && results.processed === 0) {
      console.log('\n✅ All videos are already embedded! No work needed.');
    } else {
      console.log('\n🎉 Embedding process completed successfully!');
    }
    
  } catch (error) {
    console.error('❌ Embedding failed:', error);
    process.exit(1);
  }
}

// Run the embedding
embedAllVideos();