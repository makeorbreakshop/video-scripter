import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { pineconeService } from '@/lib/pinecone-service';
import { createClient } from '@supabase/supabase-js';
import { searchLogger } from '@/lib/search-logger';
import { deduplicatePatterns } from '@/lib/pattern-deduplication';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Type definitions
interface VideoResult {
  video_id: string;
  title: string;
  channel_name: string;
  view_count: number;
  subscriber_count: number;
  performance_ratio: number;
  similarity_score: number;
  embedding?: number[];
  thread?: string;
  query?: string;
  threadPurpose?: string;
}

interface DiscoveredPattern {
  pattern: string;
  explanation: string;
  template: string;
  examples: string[];
  video_ids: string[];
  confidence: number;
  performance_multiplier: number;
}

interface ThreadExpansion {
  threadName: string;
  purpose: string;
  queries: string[];
}

// Zod schemas for OpenAI structured outputs
const threadExpansionSchema = z.object({
  threads: z.array(z.object({
    threadName: z.string(),
    purpose: z.string(),
    queries: z.array(z.string()).length(5) // Exactly 5 queries per thread
  }))
});

const patternDiscoverySchema = z.object({
  discoveredPatterns: z.array(z.object({
    pattern: z.string(),
    explanation: z.string(),
    template: z.string(),
    examples: z.array(z.string()),
    video_ids: z.array(z.string()),
    confidence: z.number(),
    performance_multiplier: z.number()
  }))
});


// Helper function to chunk arrays
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Thread expansion with GPT-4o-mini
async function expandToThreads(concept: string): Promise<ThreadExpansion[]> {
  console.log('\n🧵 Expanding concept into semantic threads...');
  
  const prompt = `You are an audience psychology expert who understands how interests cluster and what else people interested in one topic typically explore.

<concept>${concept}</concept>

<task>
Create 5 threads that follow natural audience interest patterns. Think about what else the same audience would search for based on their demonstrated interests, values, and lifestyle.
</task>

<thinking_process>
1. Profile the typical audience for this concept
2. Identify their core values and interests
3. Find adjacent interests this audience has
4. Explore their broader lifestyle choices
5. Connect to their aspirational content
</thinking_process>

<examples>
Example 1 - Input: "bulletproof coffee"
Thread: ["bulletproof coffee", "intermittent fasting", "biohacking techniques", "peak performance", "longevity science"]

Example 2 - Input: "van life setup"
Thread: ["van life setup", "remote work tips", "minimalist lifestyle", "adventure travel", "financial independence"]

Example 3 - Input: "succulent care"
Thread: ["succulent care", "indoor gardening", "home aesthetics", "mindful living", "stress reduction hobbies"]
</examples>

<constraints>
- Follow genuine audience interest patterns
- Each thread represents different audience segments
- Maintain psychological coherence
- Focus on topics, not content formats
- 5 queries per thread
</constraints>

<output_format>
{
  "threads": [
    {
      "threadName": "Thread Name Here",
      "purpose": "What this thread explores and why",
      "queries": ["query 1", "query 2", "query 3", "query 4", "query 5"]
    }
  ]
}
</output_format>`;

  const completion = await openai.beta.chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: zodResponseFormat(threadExpansionSchema, 'thread_expansion'),
    temperature: 0.8,
    max_tokens: 2000
  });

  // The parsed result is directly on the completion object
  // @ts-ignore - OpenAI SDK types don't fully expose parsed property
  if (completion.parsed) {
    // @ts-ignore
    return completion.parsed.threads;
  }
  
  // Fallback to parsing from message content if needed
  const messageContent = completion.choices[0]?.message?.content;
  if (messageContent) {
    try {
      const parsed = JSON.parse(messageContent);
      if (parsed && parsed.threads) {
        return parsed.threads;
      }
    } catch (e) {
      console.error('Failed to parse JSON from message content:', e);
    }
  }
  
  console.error('Failed to parse thread expansion response');
  throw new Error('Invalid response format from thread expansion');
}

// Search for videos using Pinecone
async function searchVideosForThreads(threads: ThreadExpansion[]): Promise<VideoResult[]> {
  console.log('\n🔍 Searching for videos across all threads...');
  
  const seenVideoIds = new Set<string>();
  
  // Create all search tasks
  const searchTasks: Promise<{thread: ThreadExpansion, query: string, results: any[]}>[] = [];
  
  for (const thread of threads) {
    console.log(`\n📍 Preparing searches for thread: ${thread.threadName}`);
    
    for (const query of thread.queries) {
      const searchTask = (async () => {
        try {
          // Get embedding for the query - using 3-small for 512 dimensions
          const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: query,
            dimensions: 512
          });
          const queryEmbedding = embeddingResponse.data[0].embedding;
          
          const searchResults = await pineconeService.searchSimilar(queryEmbedding, 100, 0.35); // 100 videos, 0.35 threshold
          
          return {
            thread,
            query,
            results: searchResults.results
          };
        } catch (error) {
          console.error(`❌ Error searching for "${query}":`, error);
          return {
            thread,
            query,
            results: []
          };
        }
      })();
      
      searchTasks.push(searchTask);
    }
  }
  
  // Execute all searches in parallel
  console.log(`\n🚀 Executing ${searchTasks.length} searches in parallel...`);
  const searchResults = await Promise.all(searchTasks);
  
  // Process results and deduplicate
  const allVideos: VideoResult[] = [];
  
  for (const { thread, query, results } of searchResults) {
    console.log(`   ✅ ${query}: Found ${results.length} videos`);
    
    results.forEach(result => {
      if (seenVideoIds.has(result.video_id)) return;
      
      const videoWithScore: VideoResult = {
        video_id: result.video_id,
        title: result.title,
        channel_name: result.channel_name,
        view_count: result.view_count,
        subscriber_count: 0, // Not available
        performance_ratio: result.performance_ratio,
        similarity_score: result.similarity_score,
        embedding: result.embedding,
        thread: thread.threadName,
        query: query,
        threadPurpose: thread.purpose
      };
      
      seenVideoIds.add(result.video_id);
      allVideos.push(videoWithScore);
    });
  }
  
  console.log(`\n📊 Total unique videos found: ${allVideos.length}`);
  return allVideos;
}

// Filter videos by performance
function filterHighPerformers(videos: VideoResult[]): VideoResult[] {
  return videos.filter(v => v.performance_ratio >= 1.0);
}

// Discover patterns for a thread
async function discoverPatternsForThread(
  videos: VideoResult[],
  thread: ThreadExpansion,
  concept: string
): Promise<DiscoveredPattern[]> {
  console.log(`\n🔍 Discovering patterns for thread: ${thread.threadName}`);
  
  const sortedVideos = videos.sort((a, b) => b.performance_ratio - a.performance_ratio);
  const topVideos = sortedVideos.slice(0, 50);
  
  const prompt = `Analyze these YouTube video titles to find LITERAL title patterns - exact words and structures that appear repeatedly.

Thread: ${thread.threadName}
Thread Purpose: ${thread.purpose}

CRITICAL INSTRUCTIONS:
1. Find 2-3 LITERAL title patterns where the EXACT SAME WORDS/PHRASES appear in multiple titles
2. DO NOT identify conceptual themes - find actual repeated text patterns
3. Each pattern MUST have the exact words/structure appearing in at least 3-5 titles
4. Focus on 🌟 SUPERSTAR videos (10x+ performance) if available, but work with what we have

Example of what to find:
- If you see "Best [X] for [Y]" in 10+ titles, that's a pattern
- If you see "How to [X] in [TIME]" in 8+ titles, that's a pattern
- If you see "[NUMBER] Ways to [X]" in 12+ titles, that's a pattern

Example of what NOT to find:
- "Step-by-step guides" (conceptual theme, not literal pattern)
- "Product comparisons" (category, not pattern)
- "Tutorial videos" (type, not pattern)

Videos to analyze:
${topVideos.map((v, i) => {
  const marker = v.performance_ratio >= 10 ? '🌟 SUPERSTAR' : 
                v.performance_ratio >= 5 ? '💪 STRONG' :
                v.performance_ratio >= 2 ? '📈 ABOVE AVG' : '📊 NORMAL';
  return `${i + 1}. [ID: ${v.video_id}] [${marker} ${v.performance_ratio.toFixed(1)}x] "${v.title}" - ${v.channel_name}`;
}).join('\n')}

For each LITERAL pattern you find:
- pattern: Name describing the literal pattern (e.g., "Best X for Y Pattern")
- explanation: Why this specific word structure works
- template: The EXACT structure with [placeholders] (e.g., "Best [product] for [use case]")
- examples: List 5-10 ACTUAL titles from above that match this pattern EXACTLY
- video_ids: The EXACT IDs from the [ID: xxx] brackets of videos using this pattern
- confidence: How confident you are this is a real pattern (0.0-1.0)
- performance_multiplier: Average performance of videos using this pattern

CRITICAL: Use the EXACT video IDs from the [ID: xxx] brackets. Do NOT make up placeholder IDs like "1", "2", "3".`;

  const completion = await openai.beta.chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: zodResponseFormat(patternDiscoverySchema, 'pattern_discovery'),
    temperature: 0.3,
    max_tokens: 4000
  });

  // The parsed result is directly on the completion object
  // @ts-ignore - OpenAI SDK types don't fully expose parsed property
  if (completion.parsed) {
    // @ts-ignore
    return completion.parsed.discoveredPatterns;
  }
  
  // Fallback to parsing from message content if needed
  const messageContent = completion.choices[0]?.message?.content;
  if (messageContent) {
    try {
      const parsed = JSON.parse(messageContent);
      if (parsed && parsed.discoveredPatterns) {
        return parsed.discoveredPatterns;
      }
    } catch (e) {
      console.error('Failed to parse JSON from message content:', e);
    }
  }
  
  console.error('Failed to parse pattern discovery response');
  throw new Error('Invalid response format from pattern discovery');
}


export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { concept } = body;
    
    if (!concept) {
      return NextResponse.json({ error: 'Concept is required' }, { status: 400 });
    }

    console.log(`\n🚀 Starting pattern-based title generation for: "${concept}"`);
    
    // Track costs
    const costs = {
      embedding: { calls: 0, cost: 0 },
      openai: { calls: 0, cost: 0 }
    };

    // Step 1: Expand concept into semantic threads
    const threads = await expandToThreads(concept);
    costs.openai.calls += 1;
    costs.openai.cost += 0.00075; // GPT-4o-mini cost estimate
    
    const expandedQueries = threads.flatMap(t => t.queries);
    console.log(`\n📝 Generated ${expandedQueries.length} queries across ${threads.length} threads`);

    // Step 2: Search for videos across all threads
    const allVideos = await searchVideosForThreads(threads);
    costs.embedding.calls += expandedQueries.length;
    costs.embedding.cost += expandedQueries.length * 0.00002; // Ada-002 embedding cost
    
    // Filter high performers
    const highPerformers = filterHighPerformers(allVideos);
    console.log(`\n📊 Filtered to ${highPerformers.length} high-performing videos`);

    // Step 3: Discover patterns for each thread in parallel
    const allPatterns: DiscoveredPattern[] = [];
    
    // Create pattern discovery tasks for all eligible threads
    const patternDiscoveryTasks = threads
      .map(thread => {
        const threadVideos = highPerformers.filter(v => v.thread === thread.threadName);
        if (threadVideos.length >= 5) {
          console.log(`   📊 Thread "${thread.threadName}" has ${threadVideos.length} videos for pattern discovery`);
          return discoverPatternsForThread(threadVideos, thread, concept);
        } else {
          console.log(`   ⚠️ Thread "${thread.threadName}" only has ${threadVideos.length} videos (need 5+)`);
          return null;
        }
      })
      .filter(task => task !== null);
    
    // Execute all pattern discovery tasks in parallel
    console.log(`\\n🚀 Executing ${patternDiscoveryTasks.length} pattern discovery tasks in parallel...`);
    const patternResults = await Promise.all(patternDiscoveryTasks);
    
    // Flatten results and update costs
    patternResults.forEach(patterns => {
      allPatterns.push(...patterns);
      costs.openai.calls += 1;
      costs.openai.cost += 0.00075; // GPT-4o-mini cost estimate
    });
    
    // Step 4: Deduplicate patterns
    const uniquePatterns = deduplicatePatterns(allPatterns);
    console.log(`\n🎯 Deduplicated from ${allPatterns.length} to ${uniquePatterns.length} unique patterns`);

    // Step 5: Convert patterns to TitleSuggestion format for UI
    let suggestions: any[] = [];
    if (uniquePatterns.length > 0) {
      suggestions = uniquePatterns.map((pattern, index) => {
        // Find the thread that contributed this pattern
        const patternVideos = highPerformers.filter(v => 
          pattern.video_ids.includes(v.video_id)
        );
        const sourceThread = patternVideos[0]?.thread || 'Unknown Thread';
        const threadPurpose = patternVideos[0]?.threadPurpose || '';
        
        return {
          title: pattern.template, // The template pattern as the title
          pattern: {
            id: `pattern_${index}`,
            name: pattern.pattern,
            template: pattern.template,
            performance_lift: pattern.performance_multiplier,
            examples: pattern.examples,
            video_ids: pattern.video_ids,
            source_thread: sourceThread,
            thread_purpose: threadPurpose,
            // UI expects these optional properties
            verification: {
              matchCount: pattern.video_ids?.length || 0,
              medianPerformance: pattern.performance_multiplier,
              avgPerformance: pattern.performance_multiplier,
              topPerformers: patternVideos.filter(v => v.performance_ratio >= 10).length,
              verificationScore: pattern.confidence
            }
          },
          evidence: {
            sample_size: pattern.video_ids?.length || 0,
            avg_performance: pattern.performance_multiplier,
            confidence_score: pattern.confidence,
          },
          explanation: pattern.explanation,
          similarity_score: 0.85, // High similarity since these are discovered patterns
          // UI accesses these at top level (not in pattern)
          verification: {
            matchCount: pattern.video_ids?.length || 0,
            medianPerformance: pattern.performance_multiplier,
            avgPerformance: pattern.performance_multiplier,
            topPerformers: patternVideos.filter(v => v.performance_ratio >= 10).length,
            verificationScore: pattern.confidence
          },
          thread_purpose: threadPurpose,
          found_by_threads: [sourceThread] // Single thread discovered this pattern
        };
      });
      console.log(`\n✍️ Converted ${uniquePatterns.length} patterns to UI format`);
    } else {
      console.log('\n⚠️ No patterns discovered - no suggestions generated');
    }
    
    const totalCost = costs.embedding.cost + costs.openai.cost;
    const totalProcessingTime = Date.now() - startTime;

    // Log the search
    const logEntry = {
      timestamp: new Date().toISOString(),
      concept,
      expandedQueries,
      expandedQueriesByThread: threads,
      searchResults: highPerformers.map(v => ({
        videoId: v.video_id,
        title: v.title,
        channelName: v.channel_name,
        similarityScore: v.similarity_score,
        performanceRatio: v.performance_ratio,
        viewCount: v.view_count,
        foundVia: {
          thread: v.thread || '',
          query: v.query || '',
          threadPurpose: v.threadPurpose || ''
        }
      })),
      performanceDistribution: {
        superstar: highPerformers.filter(v => v.performance_ratio >= 10).length,
        strong: highPerformers.filter(v => v.performance_ratio >= 3 && v.performance_ratio < 10).length,
        above_avg: highPerformers.filter(v => v.performance_ratio >= 1.5 && v.performance_ratio < 3).length,
        normal: highPerformers.filter(v => v.performance_ratio < 1.5).length
      },
      discoveredPatterns: uniquePatterns,
      originalPatternsCount: allPatterns.length,
      deduplicatedPatternsCount: uniquePatterns.length,
      finalSuggestionsCount: suggestions.length,
      processingSteps: [
        { step: 'Thread Expansion', duration: 0 },
        { step: 'Video Search', duration: 0 },
        { step: 'Pattern Discovery', duration: 0 },
        { step: 'Title Generation', duration: 0 }
      ],
      costs: {
        ...costs,
        totalCost
      },
      totalProcessingTime
    };
    
    await searchLogger.logSearch(logEntry);

    console.log('\n📤 API Response Summary:');
    console.log(`   - Concept: "${concept}"`);
    console.log(`   - Suggestions count: ${suggestions.length}`);
    console.log(`   - First suggestion:`, suggestions[0] ? {
      title: suggestions[0].title,
      hasPattern: !!suggestions[0].pattern,
      hasEvidence: !!suggestions[0].evidence,
      hasVideoIds: !!suggestions[0].pattern.video_ids,
      videoIdsCount: suggestions[0].pattern.video_ids?.length || 0
    } : 'NONE');
    console.log(`   - Total processing time: ${totalProcessingTime}ms`);

    return NextResponse.json({
      concept,
      suggestions,
      patterns: uniquePatterns,
      total_patterns_searched: uniquePatterns.length,
      semantic_neighborhoods_found: threads.length,
      processing_time_ms: totalProcessingTime,
      debug: {
        totalVideosFound: allVideos.length,
        highPerformers: highPerformers.length,
        patternsDiscovered: uniquePatterns.length,
        costs,
        processingTime: totalProcessingTime
      }
    });

  } catch (error) {
    console.error('Error generating titles:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to generate titles',
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}