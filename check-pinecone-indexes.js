#!/usr/bin/env node

/**
 * Check what Pinecone indexes actually exist
 */

import { Pinecone } from '@pinecone-database/pinecone';

async function main() {
  console.log('🔍 CHECKING PINECONE INDEXES');
  console.log('='.repeat(40));
  
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    console.log('📋 Listing all indexes...');
    const indexes = await pinecone.listIndexes();
    
    console.log(`\n✅ Found ${indexes.indexes?.length || 0} indexes:`);
    
    if (indexes.indexes && indexes.indexes.length > 0) {
      for (const indexInfo of indexes.indexes) {
        console.log(`\n📊 Index: ${indexInfo.name}`);
        console.log(`   └── Status: ${indexInfo.status?.ready ? '✅ Ready' : '⏳ Not Ready'}`);
        console.log(`   └── Host: ${indexInfo.host}`);
        console.log(`   └── Spec: ${indexInfo.spec?.pod?.environment || indexInfo.spec?.serverless?.cloud || 'Unknown'}`);
        
        try {
          const index = pinecone.index(indexInfo.name);
          const stats = await index.describeIndexStats();
          console.log(`   └── Vectors: ${stats.totalRecordCount || stats.totalVectorCount || 0}`);
          console.log(`   └── Dimensions: ${stats.dimension}`);
          console.log(`   └── Namespaces: ${Object.keys(stats.namespaces || {}).length}`);
        } catch (error) {
          console.log(`   └── Stats: ❌ ${error.message}`);
        }
      }
    }
    
    console.log('\n🎯 Environment Variables:');
    console.log(`   └── PINECONE_INDEX_NAME: ${process.env.PINECONE_INDEX_NAME}`);
    console.log(`   └── PINECONE_THUMBNAIL_INDEX_NAME: ${process.env.PINECONE_THUMBNAIL_INDEX_NAME}`);
    
    console.log('\n🔍 Index Validation:');
    const titleIndexExists = indexes.indexes?.some(idx => idx.name === process.env.PINECONE_INDEX_NAME);
    const thumbnailIndexExists = indexes.indexes?.some(idx => idx.name === process.env.PINECONE_THUMBNAIL_INDEX_NAME);
    
    console.log(`   └── Title index (${process.env.PINECONE_INDEX_NAME}): ${titleIndexExists ? '✅' : '❌'}`);
    console.log(`   └── Thumbnail index (${process.env.PINECONE_THUMBNAIL_INDEX_NAME}): ${thumbnailIndexExists ? '✅' : '❌'}`);
    
    if (!thumbnailIndexExists) {
      console.log('\n❌ PROBLEM IDENTIFIED:');
      console.log(`   The thumbnail index "${process.env.PINECONE_THUMBNAIL_INDEX_NAME}" does not exist!`);
      console.log('\n🔧 SOLUTION:');
      console.log('   1. Create the "video-thumbnails" index in Pinecone dashboard');
      console.log('   2. Use 768 dimensions (for CLIP embeddings)');
      console.log('   3. Use cosine similarity metric');
      console.log('   4. Choose appropriate cloud/region');
    }
    
  } catch (error) {
    console.error('❌ Failed to check indexes:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}