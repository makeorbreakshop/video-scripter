import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
dotenv.config();

async function testPineconeEmbeddings(videoId) {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });

  console.log('Testing embeddings for video:', videoId);
  console.log('-----------------------------------\n');

  // Test title embeddings (main index)
  try {
    const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const titleFetch = await titleIndex.fetch([videoId]);
    console.log('Title Index:', process.env.PINECONE_INDEX_NAME);
    console.log('Has title embedding:', !!titleFetch.records[videoId]?.values);
    if (titleFetch.records[videoId]) {
      console.log('Embedding dimensions:', titleFetch.records[videoId].values.length);
      console.log('Metadata:', titleFetch.records[videoId].metadata);
    }
  } catch (error) {
    console.error('Title index error:', error.message);
  }

  console.log('\n');

  // Test description embeddings (might be in main index with namespace)
  try {
    // First try the main index with llm-summaries namespace
    const mainIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const summaryFetch = await mainIndex.namespace('llm-summaries').fetch([videoId]);
    console.log('Trying main index with namespace:', process.env.PINECONE_INDEX_NAME);
    console.log('Namespace: llm-summaries');
    console.log('Has summary embedding:', !!summaryFetch.records[videoId]?.values);
    if (summaryFetch.records[videoId]) {
      console.log('Embedding dimensions:', summaryFetch.records[videoId].values.length);
      console.log('Metadata:', summaryFetch.records[videoId].metadata);
    }
  } catch (error) {
    console.error('Summary namespace error:', error.message);
    
    // Try thumbnail index as fallback
    try {
      const thumbnailIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME);
      const summaryFetch = await thumbnailIndex.namespace('llm-summaries').fetch([videoId]);
      console.log('Trying thumbnail index with namespace:', process.env.PINECONE_THUMBNAIL_INDEX_NAME);
      console.log('Has summary embedding:', !!summaryFetch.records[videoId]?.values);
    } catch (err) {
      console.error('Thumbnail index namespace error:', err.message);
    }
  }

  console.log('\n');

  // Test thumbnail embeddings
  try {
    const thumbnailIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME);
    const thumbnailFetch = await thumbnailIndex.fetch([videoId]);
    console.log('Thumbnail Index:', process.env.PINECONE_THUMBNAIL_INDEX_NAME);
    console.log('Has thumbnail embedding:', !!thumbnailFetch.records[videoId]?.values);
    if (thumbnailFetch.records[videoId]) {
      console.log('Embedding dimensions:', thumbnailFetch.records[videoId].values.length);
      console.log('Metadata:', thumbnailFetch.records[videoId].metadata);
    }
  } catch (error) {
    console.error('Thumbnail index error:', error.message);
  }

  console.log('\n-----------------------------------');
  console.log('Testing query capability...\n');

  // Test if we can query the indexes
  try {
    const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const titleFetch = await titleIndex.fetch([videoId]);
    
    if (titleFetch.records[videoId]?.values) {
      const queryResult = await titleIndex.query({
        vector: titleFetch.records[videoId].values,
        topK: 5,
        includeMetadata: true
      });
      console.log('Title query successful. Found', queryResult.matches.length, 'similar videos');
    }
  } catch (error) {
    console.error('Title query error:', error.message);
  }
}

// Get video ID from command line or use default
const videoId = process.argv[2] || 'N3tRFayqVtk';
testPineconeEmbeddings(videoId);