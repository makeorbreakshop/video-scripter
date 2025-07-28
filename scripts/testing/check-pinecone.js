import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

async function checkPinecone() {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY
  });
  
  try {
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const stats = await index.describeIndexStats();
    console.log('Pinecone Index Stats:', JSON.stringify(stats, null, 2));
    
    // Try a test query
    const testEmbedding = new Array(512).fill(0.1);
    const queryResponse = await index.query({
      vector: testEmbedding,
      topK: 10,
      includeMetadata: true
    });
    
    console.log('\nTest query results:', queryResponse.matches?.length || 0, 'matches');
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log('Sample match:', queryResponse.matches[0]);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

checkPinecone();