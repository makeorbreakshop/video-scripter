import { NextRequest } from 'next/server';
import { OpenAI } from 'openai';
import { pineconeService } from '@/lib/vector-db-service';
import { createClient } from '@supabase/supabase-js';
import { searchLogger } from '@/lib/search-logger';
import { discoverPatternsWithClaude } from '@/lib/anthropic-api';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { concept } = body;

    if (!concept || typeof concept !== 'string') {
      return new Response('Missing or invalid concept', { status: 400 });
    }

    // Create a TransformStream for SSE
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start async processing
    processRequest(concept, writer).finally(() => {
      writer.close();
    });

    // Return SSE response
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in generate-titles-stream:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

async function processRequest(concept: string, writer: WritableStreamDefaultWriter) {
  const encoder = new TextEncoder();
  
  const sendEvent = (event: string, data: any) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(message));
  };

  try {
    // Step 1: Domain Detection
    sendEvent('progress', { 
      step: 'domain',
      message: 'Analyzing search domain...',
      progress: 10
    });

    const domainContext = await detectDomain(concept);
    
    sendEvent('domain_detected', {
      domain: domainContext.primary_domain,
      keywords: domainContext.domain_keywords
    });

    // Step 2: Query Expansion
    sendEvent('progress', {
      step: 'expansion',
      message: 'Expanding search queries...',
      progress: 20
    });

    const expandedQueries = await expandConceptMultiThreaded(concept, domainContext);
    
    sendEvent('queries_expanded', {
      totalQueries: expandedQueries.reduce((sum, thread) => sum + thread.queries.length, 0),
      threads: expandedQueries.map(t => ({
        name: t.threadName,
        count: t.queries.length
      }))
    });

    // Step 3: Embeddings
    sendEvent('progress', {
      step: 'embedding',
      message: 'Creating semantic embeddings...',
      progress: 30
    });

    const allQueries = expandedQueries.flatMap(thread => thread.queries);
    const embeddings = await createEmbeddings(allQueries);
    
    sendEvent('embeddings_created', {
      count: embeddings.length,
      model: 'text-embedding-3-small'
    });

    // Step 4: Search
    sendEvent('progress', {
      step: 'search',
      message: 'Searching 122K+ videos...',
      progress: 50
    });

    const searchResults = await searchVideos(embeddings, expandedQueries);
    
    sendEvent('search_complete', {
      totalVideos: searchResults.length,
      topScore: searchResults[0]?.similarity_score || 0
    });

    // Step 5: Analysis
    sendEvent('progress', {
      step: 'analysis',
      message: 'Discovering viral patterns...',
      progress: 70
    });

    const patterns = await analyzePatterns(concept, searchResults);
    
    sendEvent('patterns_discovered', {
      count: patterns.length,
      topPerformer: patterns[0]?.performance_lift || 0
    });

    // Step 6: Generation
    sendEvent('progress', {
      step: 'generation',
      message: 'Generating title suggestions...',
      progress: 90
    });

    const suggestions = generateSuggestions(concept, patterns);
    
    // Final result
    sendEvent('complete', {
      suggestions,
      concept,
      total_patterns_searched: patterns.length,
      semantic_neighborhoods_found: searchResults.length,
      processing_time_ms: Date.now()
    });

  } catch (error) {
    console.error('Error in processRequest:', error);
    sendEvent('error', {
      message: error instanceof Error ? error.message : 'An error occurred'
    });
  }
}

// Reuse the existing functions from the main route
async function detectDomain(concept: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Analyze this search concept and identify its domain context.
Concept: "${concept}"

Return a JSON object with:
{
  "primary_domain": "one of: cooking|technology|fitness|education|entertainment|diy|business|health|travel|other",
  "domain_keywords": ["5-8 keywords that are specific to this domain"],
  "avoid_domains": ["list domains that might have overlapping terms but should be avoided"],
  "disambiguation_terms": ["terms to add to queries to keep them in the right domain"]
}`
      }],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });
    
    return JSON.parse(response.choices[0].message.content || '{}');
  } catch (error) {
    console.error('Error detecting domain:', error);
    return {
      primary_domain: "general",
      domain_keywords: [],
      avoid_domains: [],
      disambiguation_terms: []
    };
  }
}

// Placeholder functions - in real implementation, import from main route
async function expandConceptMultiThreaded(concept: string, domainContext: any) {
  // Implementation would be imported from main route
  return [];
}

async function createEmbeddings(queries: string[]) {
  // Implementation would be imported from main route
  return [];
}

async function searchVideos(embeddings: any[], expandedQueries: any[]) {
  // Implementation would be imported from main route
  return [];
}

async function analyzePatterns(concept: string, videos: any[]) {
  // Implementation would be imported from main route
  return [];
}

function generateSuggestions(concept: string, patterns: any[]) {
  // Implementation would be imported from main route
  return [];
}