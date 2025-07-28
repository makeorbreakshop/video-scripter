import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Check for API key
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is not set');
  console.log('Available environment variables:', Object.keys(process.env).filter(k => k.includes('ANTHROPIC')));
  process.exit(1);
}

console.log('API Key found:', process.env.ANTHROPIC_API_KEY.substring(0, 10) + '...');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Test the API
async function testAPI() {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: 'Say hello!'
        }
      ]
    });
    
    console.log('API Response:', response.content[0].text);
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

testAPI();