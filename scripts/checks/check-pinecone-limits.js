import { Pinecone } from '@pinecone-database/pinecone';
import { config } from 'dotenv';

config();

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

async function checkPineconeLimits() {
  console.log('🔍 Checking Pinecone Limits & Stats\n');

  // Typical Pinecone Limits (as of 2024)
  console.log('📊 Pinecone Rate Limits (Serverless):');
  console.log('  - Upsert: 200 requests/second');
  console.log('  - Query: 600 requests/second');
  console.log('  - Delete: 100 requests/second');
  console.log('  - Fetch: 600 requests/second');
  console.log('  - Batch Size: 100 vectors per upsert');
  console.log('  - Max Vector Dimension: 20,000');
  console.log('  - Max Metadata Size: 40KB per vector');

  try {
    // Check your indexes
    const indexes = await pinecone.listIndexes();
    console.log('\n📋 Your Pinecone Indexes:');
    
    for (const indexInfo of indexes.indexes || []) {
      console.log(`\n  Index: ${indexInfo.name}`);
      console.log(`  - Status: ${indexInfo.status?.ready ? 'Ready' : 'Not Ready'}`);
      console.log(`  - Dimension: ${indexInfo.dimension}`);
      console.log(`  - Metric: ${indexInfo.metric}`);
      
      if (indexInfo.status?.ready) {
        const index = pinecone.index(indexInfo.name);
        const stats = await index.describeIndexStats();
        
        console.log(`  - Total Vectors: ${stats.totalVectorCount || 0}`);
        console.log(`  - Namespaces: ${Object.keys(stats.namespaces || {}).length}`);
        
        if (stats.namespaces) {
          Object.entries(stats.namespaces).forEach(([ns, data]) => {
            console.log(`    * ${ns}: ${data.vectorCount} vectors`);
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking Pinecone:', error.message);
  }

  console.log('\n⚡ Best Practices:');
  console.log('  - Batch upserts in groups of 100');
  console.log('  - Use async/parallel processing');
  console.log('  - Implement exponential backoff for rate limits');
  console.log('  - Monitor 429 (rate limit) errors');
}

checkPineconeLimits().catch(console.error);