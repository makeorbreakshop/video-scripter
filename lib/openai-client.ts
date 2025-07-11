import OpenAI from 'openai';

// Server-side OpenAI client for use in API routes and server components
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Export the OpenAI class as well if needed
export { OpenAI };