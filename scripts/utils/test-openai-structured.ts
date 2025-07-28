import { openai } from './lib/openai-client';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

// Define the schema
const ThreadSchema = z.object({
  angle: z.string(),
  intent: z.string(),
  queries: z.array(z.string()).min(5).max(5)
});

const ThreadExpansionSchema = z.object({
  threads: z.array(ThreadSchema)
});

async function testStructuredOutput() {
  try {
    console.log('Testing OpenAI structured output...');
    
    const response = await openai.beta.chat.completions.parse({
      model: 'gpt-4o-mini',
      messages: [{
        role: "user",
        content: `Create 2 threads of search queries for "fiber laser engraver". Return JSON with a 'threads' array where each thread has 'angle', 'intent', and 'queries' (exactly 5 queries).`
      }],
      response_format: zodResponseFormat(ThreadExpansionSchema, "thread_expansion"),
      temperature: 0.7,
      max_tokens: 2000
    });
    
    console.log('Response:', {
      parsed: response.parsed,
      usage: response.usage,
      hasChoices: !!response.choices?.[0],
      rawContent: response.choices?.[0]?.message?.content
    });
    
    if (!response.parsed && response.choices?.[0]?.message?.content) {
      console.log('\nRaw content:', response.choices[0].message.content);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testStructuredOutput();