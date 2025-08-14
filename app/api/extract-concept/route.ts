import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request: NextRequest) {
  try {
    const { transcript } = await request.json();
    
    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: 'Transcript is required' }, { status: 400 });
    }

    const claudeApi = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const conceptPrompt = `
You are analyzing a video transcript to extract the core concept for content creation. Your goal is to identify the key elements that would help find similar high-performing videos through semantic search.

TRANSCRIPT:
${transcript}

Extract the following elements and format as JSON:

{
  "core_topic": "The main subject matter in 2-4 words",
  "value_promise": "What the viewer gets/learns/experiences",
  "emotional_hook": "Why viewers care - the stakes, curiosity gap, or transformation promised", 
  "key_entities": ["Specific brands", "products", "people", "tools", "locations mentioned"],
  "content_format": "The video format (tutorial, review, story, experiment, reaction, etc.)",
  "target_keywords": ["5-7 search terms that capture the essence of this content"],
  "semantic_queries": [
    "3-5 search queries optimized for finding similar viral videos",
    "Include variations of the core concept",
    "Focus on what makes content emotionally compelling"
  ],
  "concept_summary": "2-sentence description of what makes this video concept unique and engaging"
}

Focus on extracting elements that would help identify similar viral patterns across different niches. Think about what psychological triggers, content structures, or value propositions would translate across topics.
`;

    const response = await claudeApi.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: conceptPrompt
        }
      ]
    });

    const conceptText = response.content[0].text;
    
    // Parse JSON response
    let concept;
    try {
      // Extract JSON from the response
      const jsonMatch = conceptText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        concept = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse concept JSON:', parseError);
      return NextResponse.json({ 
        error: 'Failed to extract concept from transcript' 
      }, { status: 500 });
    }

    // Validate required fields
    const requiredFields = ['core_topic', 'value_promise', 'emotional_hook', 'semantic_queries'];
    const missingFields = requiredFields.filter(field => !concept[field]);
    
    if (missingFields.length > 0) {
      return NextResponse.json({ 
        error: `Missing required concept fields: ${missingFields.join(', ')}` 
      }, { status: 500 });
    }

    return NextResponse.json({
      concept,
      extracted_at: new Date().toISOString(),
      transcript_length: transcript.length
    });

  } catch (error: any) {
    console.error('Concept extraction error:', error);
    
    if (error.code === 'rate_limit_exceeded') {
      return NextResponse.json({ 
        error: 'Rate limit exceeded. Please wait a moment and try again.' 
      }, { status: 429 });
    }

    return NextResponse.json({ 
      error: 'Failed to extract concept from transcript' 
    }, { status: 500 });
  }
}