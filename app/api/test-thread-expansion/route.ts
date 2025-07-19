import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

// Initialize Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Schema for thread expansion
const ThreadExpansionSchema = z.object({
  threads: z.array(z.object({
    angle: z.string(),
    intent: z.string(),
    queries: z.array(z.string()).min(5).max(5)
  })).length(15)
});

export async function POST(request: NextRequest) {
  try {
    const { concept, prompt, model, temperature = 0.8 } = await request.json();
    
    if (!concept || !prompt || !model) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    let result;
    let tokensUsed = { input: 0, output: 0 };
    
    // Check if it's an OpenAI model
    if (model.startsWith('gpt-')) {
      try {
        const response = await openai.beta.chat.completions.parse({
          model,
          messages: [{
            role: "user",
            content: prompt + "\n\nReturn a JSON object with a 'threads' array. Each thread must have exactly 5 queries."
          }],
          response_format: zodResponseFormat(ThreadExpansionSchema, "thread_expansion"),
          temperature,
          max_tokens: 4000
        });
        
        if (!response.parsed) {
          throw new Error('Failed to parse response');
        }
        
        result = response.parsed.threads;
        tokensUsed = {
          input: response.usage?.prompt_tokens || 0,
          output: response.usage?.completion_tokens || 0
        };
      } catch (error) {
        console.error('OpenAI error:', error);
        throw error;
      }
    } 
    // Otherwise it's an Anthropic model
    else if (model.startsWith('claude-')) {
      try {
        const response = await anthropic.messages.create({
          model,
          max_tokens: 4000,
          temperature,
          messages: [{
            role: "user",
            content: prompt + "\n\nReturn ONLY a JSON object with this structure: {\"threads\": [{\"angle\": \"...\", \"intent\": \"...\", \"queries\": [\"...\", \"...\", \"...\", \"...\", \"...\"]}]} with exactly 15 threads and 5 queries each."
          }]
        });
        
        const content = response.content[0].type === 'text' ? response.content[0].text : '';
        
        // Extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No valid JSON found in response');
        }
        
        const parsed = JSON.parse(jsonMatch[0]);
        result = parsed.threads;
        
        tokensUsed = {
          input: response.usage.input_tokens,
          output: response.usage.output_tokens
        };
      } catch (error) {
        console.error('Anthropic error:', error);
        throw error;
      }
    } else {
      return NextResponse.json({ error: 'Invalid model specified' }, { status: 400 });
    }
    
    // Ensure we have valid threads
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error('Invalid response format - no threads found');
    }
    
    return NextResponse.json({
      threads: result,
      tokensUsed,
      model
    });
    
  } catch (error) {
    console.error('Thread expansion test error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to expand threads' 
    }, { 
      status: 500 
    });
  }
}