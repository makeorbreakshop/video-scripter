#!/usr/bin/env npx tsx
/**
 * Direct Pinecone test - check if it has data
 */

import dotenv from 'dotenv';
import path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testPinecone() {
  console.log('\n🔍 TESTING PINECONE DIRECTLY\n');
  
  try {
    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!
    });
    
    const indexName = process.env.PINECONE_INDEX_NAME || 'youtube-video-titles';
    console.log(`Connecting to index: ${indexName}`);
    
    const index = pinecone.index(indexName);
    
    // Get index stats
    const stats = await index.describeIndexStats();
    console.log('\n📊 Index Statistics:');
    console.log(`Total vectors: ${stats.totalRecordCount}`);
    console.log(`Dimensions: ${stats.dimension}`);
    console.log('Namespaces:', Object.keys(stats.namespaces || {}));
    
    // If we have the default namespace, check it
    if (stats.namespaces && stats.namespaces['']) {
      console.log(`\nDefault namespace count: ${stats.namespaces[''].recordCount}`);
    }
    
    // Try a simple search
    console.log('\n🔍 Testing search...');
    
    // Generate a random vector for testing
    const testVector = new Array(512).fill(0).map(() => Math.random() - 0.5);
    
    const searchResult = await index.query({
      vector: testVector,
      topK: 5,
      includeMetadata: true
    });
    
    console.log(`\nSearch returned ${searchResult.matches?.length || 0} results`);
    
    if (searchResult.matches && searchResult.matches.length > 0) {
      console.log('\nFirst 3 results:');
      searchResult.matches.slice(0, 3).forEach((match, i) => {
        console.log(`${i + 1}. ID: ${match.id}, Score: ${match.score}`);
        if (match.metadata) {
          console.log(`   Metadata: ${JSON.stringify(match.metadata).substring(0, 100)}...`);
        }
      });
    }
    
    // Test with OpenAI embedding
    console.log('\n🤖 Testing with real OpenAI embedding...');
    
    const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'satisfying mechanical keyboard',
        dimensions: 512
      })
    });
    
    const embedData = await openaiResponse.json();
    
    if (embedData.data?.[0]?.embedding) {
      const realSearchResult = await index.query({
        vector: embedData.data[0].embedding,
        topK: 10,
        includeMetadata: true
      });
      
      console.log(`\nReal embedding search returned ${realSearchResult.matches?.length || 0} results`);
      
      if (realSearchResult.matches && realSearchResult.matches.length > 0) {
        console.log('\nTop 5 results for "satisfying mechanical keyboard":');
        realSearchResult.matches.slice(0, 5).forEach((match, i) => {
          console.log(`${i + 1}. ID: ${match.id}, Score: ${match.score?.toFixed(3)}`);
        });
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testPinecone();