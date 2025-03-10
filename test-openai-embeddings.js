// Simple test script to verify OpenAI embeddings functionality
const { OpenAI } = require('openai');
require('dotenv').config({ path: '.env.local' });

async function testOpenAIEmbeddings() {
  try {
    console.log('Testing OpenAI embeddings...');
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Error: OPENAI_API_KEY is not configured in .env.local');
      return;
    }
    
    console.log('API Key found:', apiKey.substring(0, 10) + '...');
    
    const openai = new OpenAI({
      apiKey: apiKey
    });
    
    const testText = 'This is a test sentence to generate embeddings.';
    console.log('Generating embeddings for:', testText);
    
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: testText,
      encoding_format: 'float'
    });
    
    console.log('Embedding generated successfully!');
    console.log('Embedding dimensions:', response.data[0].embedding.length);
    console.log('First 5 values:', response.data[0].embedding.slice(0, 5));
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error testing OpenAI embeddings:', error);
  }
}

testOpenAIEmbeddings(); 