import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';
import { pineconeService } from '@/lib/pinecone-service';
import { supabase } from '@/lib/supabase';
// import { AnthropicAPI } from '@/lib/anthropic-api'; // No longer needed - using OpenAI
import { searchLogger } from '@/lib/search-logger';

export interface TitleGenerationRequest {
  concept: string;
  options?: {
    style?: 'informative' | 'emotional' | 'curiosity';
    maxSuggestions?: number;
    includeExamples?: boolean;
  };
}

interface DiscoveredPattern {
  pattern: string;
  explanation: string;
  template: string;
  examples: string[];
  video_ids: string[]; // IDs of videos that demonstrate this pattern
  confidence: number;
  performance_multiplier: number;
}

export interface TitleSuggestion {
  title: string;
  pattern: {
    id: string;
    name: string;
    template?: string;
    performance_lift: number;
    examples: string[];
    video_ids: string[]; // IDs of videos that demonstrate this pattern
    source_thread?: string; // Which thread discovered this pattern
    thread_purpose?: string; // Purpose of the thread that found this
  };
  evidence: {
    sample_size: number;
    avg_performance: number;
    confidence_score: number;
  };
  explanation: string;
  similarity_score: number;
}

export interface TitleGenerationResponse {
  suggestions: TitleSuggestion[];
  concept: string;
  total_patterns_searched: number;
  semantic_neighborhoods_found: number;
  processing_time_ms: number;
  debug?: {
    embeddingLength: number;
    searchThreshold: number;
    totalVideosFound: number;
    scoreDistribution: Record<string, number>;
    topVideos: Array<{
      id: string;
      title: string;
      score: number;
      channel: string;
    }>;
    claudePrompt?: string;
    claudePatterns?: any[];
    processingSteps: Array<{
      step: string;
      duration_ms: number;
      details?: any;
    }>;
    costs?: {
      embedding: {
        tokens: number;
        cost: number;
      };
      claude: {
        inputTokens: number;
        outputTokens: number;
        inputCost: number;
        outputCost: number;
        totalCost: number;
      };
      totalCost: number;
    };
  };
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let body: TitleGenerationRequest;
  
  try {
    body = await req.json();
    
    const processingSteps: Array<{ step: string; duration_ms: number; details?: any }> = [];
    let stepStart = Date.now();
    
    if (!body.concept) {
      return NextResponse.json({ error: 'Concept is required' }, { status: 400 });
    }

    console.log('🎯 Generating titles for concept:', body.concept);
    
    // Check if Pinecone is configured
    if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
      console.error('Pinecone not configured');
      return NextResponse.json({
        error: 'Pinecone configuration missing. Please set PINECONE_API_KEY and PINECONE_INDEX_NAME environment variables.'
      }, { status: 500 });
    }

    // 1. LLM-driven thread expansion (15 threads)
    stepStart = Date.now();
    const threads = await expandThreadsWithLLM(body.concept);
    
    // Create query-to-thread mapping for provenance tracking
    const queryToThread = new Map<string, { thread: string; purpose: string }>();
    const allQueries: string[] = [];
    
    // Process each thread's queries
    threads.forEach(thread => {
      allQueries.push(thread.query);
      queryToThread.set(thread.query, { 
        thread: thread.angle,
        purpose: thread.intent
      });
    });
    
    processingSteps.push({
      step: 'LLM Thread Expansion',
      duration_ms: Date.now() - stepStart,
      details: {
        originalQuery: body.concept,
        threads: threads.map(t => ({
          query: t.query,
          angle: t.angle,
          intent: t.intent
        })),
        totalQueries: allQueries.length
      }
    });

    // 2. Embed all queries
    stepStart = Date.now();
    const embeddings = await Promise.all(
      allQueries.map(query => embedConcept(query))
    );
    const totalEmbeddingTokens = embeddings.reduce((sum, e) => sum + e.tokens, 0);
    const totalEmbeddingCost = embeddings.reduce((sum, e) => sum + e.cost, 0);
    processingSteps.push({
      step: 'Multi-Query Embedding',
      duration_ms: Date.now() - stepStart,
      details: {
        embeddingModel: 'text-embedding-3-small',
        queriesEmbedded: embeddings.length,
        totalTokens: totalEmbeddingTokens,
        totalCost: totalEmbeddingCost
      }
    });
    
    // 3. Search for videos using all embeddings
    stepStart = Date.now();
    console.log(`Searching Pinecone with ${embeddings.length} query embeddings`);
    const searchThreshold = 0.35; // Lowered threshold to get more videos
    const videosPerQuery = 500; // Increased to get more videos per thread
    const searchPromises = embeddings.map((embedding, index) => 
      pineconeService.searchSimilar(
        embedding.embedding,
        videosPerQuery,
        searchThreshold
      ).then(result => ({
        query: allQueries[index],
        results: result.results
      }))
    );
    
    const searchResults = await Promise.all(searchPromises);
    
    // Deduplicate and merge results with attribution
    const videoScoreMap = new Map<string, VideoWithAttribution>();
    
    searchResults.forEach(({ query, results }) => {
      const threadInfo = queryToThread.get(query) || { thread: 'unknown', purpose: 'unknown' };
      
      results.forEach(result => {
        const existing = videoScoreMap.get(result.video_id);
        if (!existing || result.similarity_score > existing.similarity_score) {
          videoScoreMap.set(result.video_id, {
            video_id: result.video_id,
            similarity_score: existing ? Math.max(existing.similarity_score, result.similarity_score) : result.similarity_score,
            thread: existing && existing.similarity_score === result.similarity_score ? existing.thread : threadInfo.thread,
            query: existing && existing.similarity_score === result.similarity_score ? existing.query : query,
            threadPurpose: existing && existing.similarity_score === result.similarity_score ? existing.threadPurpose : threadInfo.purpose
          });
        }
      });
    });
    
    const similarVideos = Array.from(videoScoreMap.values())
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 3000); // Take top 3,000 unique videos for wider coverage
    
    // Calculate score distribution
    const scoreDistribution: Record<string, number> = {};
    similarVideos.forEach(v => {
      const bucket = (Math.floor(v.similarity_score * 10) / 10).toFixed(1);
      scoreDistribution[bucket] = (scoreDistribution[bucket] || 0) + 1;
    });
    
    processingSteps.push({
      step: 'Multi-Query Pinecone Search',
      duration_ms: Date.now() - stepStart,
      details: {
        threshold: searchThreshold,
        videosPerQuery,
        totalQueriesSearched: allQueries.length,
        totalResultsBeforeDedupe: searchResults.reduce((sum, r) => sum + r.results.length, 0),
        uniqueVideosFound: similarVideos.length,
        scoreDistribution
      }
    });
    
    console.log(`Pinecone search returned ${similarVideos.length} results`);
    
    if (similarVideos.length === 0) {
      console.log('No similar videos found - trying with lower threshold');
      // Try again with even lower threshold
      stepStart = Date.now();
      const { results: fallbackVideos } = await pineconeService.searchSimilar(
        embeddings[0].embedding,  // Use the first embedding for fallback
        100,
        0.3  // Very low threshold
      );
      processingSteps.push({
        step: 'Fallback Search',
        duration_ms: Date.now() - stepStart,
        details: { resultsFound: fallbackVideos.length }
      });
      
      console.log(`Fallback search returned ${fallbackVideos.length} results`);
      
      if (fallbackVideos.length === 0) {
        return NextResponse.json({
          suggestions: [],
          concept: body.concept,
          total_patterns_searched: 0,
          semantic_neighborhoods_found: 0,
          processing_time_ms: Date.now() - startTime,
          debug: {
            embeddingLength: embeddings[0]?.embedding.length || 512,
            searchThreshold,
            totalVideosFound: 0,
            scoreDistribution,
            topVideos: [],
            processingSteps,
            costs: {
              embedding: {
                tokens: totalEmbeddingTokens,
                cost: totalEmbeddingCost
              },
              claude: {
                inputTokens: 0,
                outputTokens: 0,
                inputCost: 0,
                outputCost: 0,
                totalCost: 0
              },
              totalCost: totalEmbeddingCost
            }
          }
        });
      }
      similarVideos.push(...fallbackVideos);
    }
    
    console.log(`Found ${similarVideos.length} similar videos for pattern discovery`);
    
    // Get video details for debug info AND comprehensive logging
    stepStart = Date.now();
    const videoIds = similarVideos.map(v => v.video_id);
    const { data: allVideoDetails } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, performance_ratio')
      .in('id', videoIds);
    
    // Create comprehensive video list for logging with attribution
    const allVideosWithDetails = similarVideos.map(v => {
      const details = allVideoDetails?.find(d => d.id === v.video_id);
      return {
        videoId: v.video_id,
        title: details?.title || 'Unknown',
        channelName: details?.channel_name || 'Unknown',
        similarityScore: v.similarity_score,
        performanceRatio: details?.performance_ratio || 0,
        viewCount: details?.view_count || 0,
        // Add attribution data
        foundVia: {
          thread: v.thread,
          query: v.query,
          threadPurpose: v.threadPurpose
        }
      };
    });
    
    // Top 10 for existing debug panel
    const topVideos = allVideosWithDetails.slice(0, 10).map(v => ({
      id: v.videoId,
      title: v.title,
      score: v.similarityScore,
      channel: v.channelName
    }));
    
    processingSteps.push({
      step: 'Fetch Video Details',
      duration_ms: Date.now() - stepStart,
      details: { 
        videosFetched: allVideoDetails?.length || 0,
        totalVideosProcessed: allVideosWithDetails.length
      }
    });
    
    // 3. Pool-and-cluster pattern discovery
    stepStart = Date.now();
    
    // Step 3a: Create pooled videos with full provenance tracking
    const pooledVideos = await createPooledVideosWithProvenance(similarVideos, allVideoDetails);
    console.log(`🏊 Created pool of ${pooledVideos.length} videos with provenance`);
    
    // Step 3b: Cluster videos by content similarity
    const clusters = await clusterVideosByContent(pooledVideos);
    console.log(`🔮 Discovered ${clusters.length} content clusters`);
    
    // Step 3c: Analyze each cluster for patterns
    const threadAnalysisPromises = clusters.map(async (cluster) => {
      const threadSources = Array.from(cluster.thread_sources).join(', ');
      const isWide = cluster.thread_sources.size >= 3;
      
      console.log(`🧵 Analyzing cluster with ${cluster.videos.length} videos from ${cluster.thread_sources.size} threads: ${threadSources}`);
      
      // Run pattern analysis with cluster context
      // Convert pooled videos to the format expected by pattern analysis
      const clusterVideosForAnalysis = cluster.videos.slice(0, 100).map(v => ({
        video_id: v.video_id,
        similarity_score: v.similarity_score
      }));
      
      const result = await discoverPatternsWithClaude(
        clusterVideosForAnalysis,
        body.concept,
        `${isWide ? 'WIDE' : 'DEEP'} cluster from threads: ${threadSources}`
      );
      
      return {
        cluster_id: clusters.indexOf(cluster),
        thread_sources: Array.from(cluster.thread_sources),
        is_wide: isWide,
        avg_performance: cluster.avg_performance,
        video_count: cluster.videos.length,
        ...result
      };
    });
    
    const clusterAnalysisResults = await Promise.all(threadAnalysisPromises);
    
    // Combine patterns from all clusters with attribution
    const allPatterns: DiscoveredPattern[] = [];
    let totalClaudeInputTokens = 0;
    let totalClaudeOutputTokens = 0;
    const claudePrompts: Record<string, string> = {};
    
    clusterAnalysisResults.forEach(result => {
      // Add cluster attribution to each pattern
      result.patterns.forEach(pattern => {
        allPatterns.push({
          ...pattern,
          source_thread: result.thread_sources.join(', '),
          thread_purpose: result.is_wide ? 'WIDE cross-thread pattern' : 'DEEP specialized pattern',
          cluster_info: {
            is_wide: result.is_wide,
            thread_sources: result.thread_sources,
            avg_performance: result.avg_performance,
            video_count: result.video_count
          }
        } as DiscoveredPattern & { 
          source_thread: string; 
          thread_purpose: string;
          cluster_info: {
            is_wide: boolean;
            thread_sources: string[];
            avg_performance: number;
            video_count: number;
          };
        });
      });
      
      // Aggregate token usage
      if (result.usage) {
        totalClaudeInputTokens += result.usage.input_tokens;
        totalClaudeOutputTokens += result.usage.output_tokens;
      }
      
      // Store prompts for debugging
      claudePrompts[`cluster_${result.cluster_id}`] = result.prompt;
    });
    
    // Sort patterns by performance multiplier
    allPatterns.sort((a, b) => b.performance_multiplier - a.performance_multiplier);
    
    // Calculate total OpenAI costs (using GPT-4o-mini pricing)
    const openaiInputCost = (totalClaudeInputTokens / 1_000_000) * 0.15;  // $0.15/1M tokens
    const openaiOutputCost = (totalClaudeOutputTokens / 1_000_000) * 0.60; // $0.60/1M tokens
    const openaiTotalCost = openaiInputCost + openaiOutputCost;
    
    // Use the first cluster's stats for backward compatibility
    const stats = clusterAnalysisResults[0]?.stats;
    
    processingSteps.push({
      step: 'Multi-Threaded Pattern Discovery',
      duration_ms: Date.now() - stepStart,
      details: {
        threadsAnalyzed: clusterAnalysisResults.length,
        threadBreakdown: clusterAnalysisResults.map(t => ({
          thread: t.thread_sources.join(', '),
          videosAnalyzed: t.stats?.analyzedCount || 0,
          patternsFound: t.patterns.length
        })),
        totalVideosFound: stats?.totalVideos || 0,
        performanceDistribution: stats?.performanceDistribution || {},
        totalPatternsFound: allPatterns.length,
        inputTokens: totalClaudeInputTokens,
        outputTokens: totalClaudeOutputTokens,
        cost: openaiTotalCost
      }
    });
    
    // Phase 2: Find more examples of each pattern
    stepStart = Date.now();
    console.log(`🔍 Phase 2: Searching for more pattern examples for ${allPatterns.length} patterns...`);
    
    // For each discovered pattern, search for more similar titles
    const enrichedPatterns = await Promise.all(
      allPatterns.map(async (pattern) => {
        try {
          // Skip if pattern doesn't have required fields
          if (!pattern.template || !pattern.video_ids) {
            return pattern;
          }
          
          // Create a search query based on the pattern template
          const patternQuery = pattern.template
            .replace(/\[.*?\]/g, '') // Remove placeholders
            .trim();
          
          if (!patternQuery) {
            return pattern;
          }
          
          // Search for videos with similar titles
          const patternEmbeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: patternQuery,
            dimensions: 512
          });
          const patternEmbedding = patternEmbeddingResponse.data[0].embedding;
          
          const { results: similarTitles } = await pineconeService.searchSimilar(
            patternEmbedding,
            50, // Find up to 50 similar titles
            0.5  // Use a moderate threshold
          );
          
          // Get video details for the matches
          if (similarTitles.length > 0) {
            const videoIds = similarTitles.map(v => v.video_id);
            const { data: videos } = await supabase
              .from('videos')
              .select('id, title, performance_ratio')
              .in('id', videoIds)
              .gte('performance_ratio', 1.5); // Only high performers
            
            // Add the newly found video IDs to the pattern
            const existingIds = new Set(pattern.video_ids);
            const newHighPerformers = videos
              ?.filter(v => !existingIds.has(v.id))
              .sort((a, b) => b.performance_ratio - a.performance_ratio)
              .slice(0, 15) // Add up to 15 more examples
              .map(v => v.id) || [];
            
            return {
              ...pattern,
              video_ids: [...pattern.video_ids, ...newHighPerformers],
              additional_examples_found: newHighPerformers.length
            };
          }
        } catch (error) {
          console.error('Error enriching pattern:', pattern.pattern, error);
          // Return pattern unchanged if enrichment fails
          return pattern;
        }
        
        return pattern;
      })
    );
    
    processingSteps.push({
      step: 'Phase 2: Pattern Example Enrichment',
      duration_ms: Date.now() - stepStart,
      details: {
        patternsEnriched: enrichedPatterns.length,
        totalAdditionalExamples: enrichedPatterns.reduce((sum, p) => 
          sum + (p.additional_examples_found || 0), 0
        )
      }
    });
    
    // Use enriched patterns instead of original
    const finalPatterns = enrichedPatterns.filter(p => p !== undefined);
    console.log(`📊 Debug: ${finalPatterns.length} final patterns`);
    
    // 4. WORKING: Skip verification and use patterns directly
    stepStart = Date.now();
    console.log('🔍 Using patterns directly (no verification)...');
    const verifiedPatterns = finalPatterns;
    
    processingSteps.push({
      step: 'Pattern Verification',
      duration_ms: Date.now() - stepStart,
      details: {
        patternsAnalyzed: finalPatterns.length,
        patternsVerified: verifiedPatterns.length,
        patternsFiltered: finalPatterns.length - verifiedPatterns.length
      }
    });
    
    // 5. Generate titles using the verified patterns
    stepStart = Date.now();
    const suggestions = await generateTitlesFromPatterns(verifiedPatterns, body.concept, body.options);
    processingSteps.push({
      step: 'Title Generation',
      duration_ms: Date.now() - stepStart,
      details: { titlesGenerated: suggestions.length }
    });
    
    const processingTime = Date.now() - startTime;
    
    // Log comprehensive search data for analysis
    try {
      await searchLogger.logSearch({
        timestamp: new Date().toISOString(),
        concept: body.concept,
        expandedQueries: allQueries.slice(1), // Remove original concept
        expandedQueriesByThread: threads.map(t => ({ threadName: t.angle, queries: [t.query] })),
        searchResults: allVideosWithDetails,
        performanceDistribution: stats?.performanceDistribution || {},
        claudePrompts: claudePrompts,
        discoveredPatterns: finalPatterns,
        threadAnalysis: clusterAnalysisResults.map(t => ({
          thread: t.thread_sources.join(', '),
          videosAnalyzed: t.stats?.analyzedCount || 0,
          patternsFound: t.patterns.length
        })),
        processingSteps,
        costs: {
          embedding: {
            tokens: totalEmbeddingTokens,
            cost: totalEmbeddingCost
          },
          claude: {
            inputTokens: totalClaudeInputTokens,
            outputTokens: totalClaudeOutputTokens,
            inputCost: openaiInputCost,
            outputCost: openaiOutputCost,
            totalCost: openaiTotalCost
          },
          totalCost: totalEmbeddingCost + openaiTotalCost
        },
        totalProcessingTime: processingTime
      });
    } catch (error) {
      console.error('Error logging search data:', error);
    }
    
    const response: TitleGenerationResponse = {
      suggestions: suggestions.slice(0, body.options?.maxSuggestions || 8),
      concept: body.concept,
      total_patterns_searched: finalPatterns.length,
      semantic_neighborhoods_found: threads.length,
      processing_time_ms: processingTime,
      debug: {
        embeddingLength: embeddings[0]?.embedding.length || 512,
        searchThreshold,
        totalVideosFound: similarVideos.length,
        scoreDistribution,
        topVideos,
        allVideosWithDetails: allVideosWithDetails,
        // Multi-threaded debug info
        threads: threads.map(t => ({
          name: t.angle,
          purpose: t.intent,
          queries: [t.query],
          videosFound: 0 // Will be populated by clustering
        })),
        claudePrompts: claudePrompts,
        claudeResponse: finalPatterns,
        claudePatterns: finalPatterns,
        processingSteps,
        costs: {
          embedding: {
            tokens: totalEmbeddingTokens,
            cost: totalEmbeddingCost
          },
          claude: {
            inputTokens: totalClaudeInputTokens,
            outputTokens: totalClaudeOutputTokens,
            inputCost: openaiInputCost,
            outputCost: openaiOutputCost,
            totalCost: openaiTotalCost
          },
          totalCost: totalEmbeddingCost + openaiTotalCost
        }
      }
    };

    const nextResponse = NextResponse.json(response);
    
    // Add cache-busting headers
    nextResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    nextResponse.headers.set('Pragma', 'no-cache');
    nextResponse.headers.set('Expires', '0');
    
    return nextResponse;
    
  } catch (error) {
    console.error('Error generating titles:', error);
    
    // Return a valid response structure even on error
    return NextResponse.json({
      suggestions: [],
      concept: body?.concept || '',
      total_patterns_searched: 0,
      semantic_neighborhoods_found: 0,
      processing_time_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Failed to generate titles'
    }, { status: 200 }); // Return 200 to prevent page refresh
  }
}

async function embedConcept(concept: string): Promise<{ embedding: number[]; tokens: number; cost: number }> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: concept,
    dimensions: 512
  });
  
  // OpenAI text-embedding-3-small costs $0.02 per 1M tokens
  const tokens = response.usage?.total_tokens || concept.split(' ').length * 1.3; // Estimate if not provided
  const cost = (tokens / 1_000_000) * 0.02;
  
  return {
    embedding: response.data[0].embedding,
    tokens,
    cost
  };
}

// Types for multi-threaded expansion
interface ThreadExpansion {
  threadId: string;
  threadName: string;
  purpose: string;
  queries: string[];
}

interface VideoWithAttribution {
  video_id: string;
  similarity_score: number;
  thread: string;
  query: string;
  threadPurpose: string;
}

async function classifyQueryType(concept: string): Promise<{
  type: 'product_review' | 'technique' | 'comparison' | 'general';
  specificity: 'high' | 'medium' | 'low';
  hasFormat: boolean;
}> {
  // Simple classification based on keywords
  const lowerConcept = concept.toLowerCase();
  
  const type = 
    lowerConcept.includes('review') ? 'product_review' :
    lowerConcept.includes('vs') || lowerConcept.includes('versus') ? 'comparison' :
    lowerConcept.includes('how to') || lowerConcept.includes('tutorial') ? 'technique' :
    'general';
  
  // Check specificity by looking for brand/model names
  const specificity = 
    /[a-z]+\s+[a-z0-9]+\s+(ultra|pro|plus|v\d|mk\d)/i.test(concept) ? 'high' :
    /[a-z]+\s+[a-z0-9]+/i.test(concept) ? 'medium' :
    'low';
    
  const hasFormat = ['review', 'tutorial', 'comparison', 'guide', 'tips'].some(f => 
    lowerConcept.includes(f)
  );
  
  return { type, specificity, hasFormat };
}

// Domain detection for better query expansion
async function detectDomain(concept: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `Analyze this search concept and identify its domain context.
Concept: "${concept}"

Return a JSON object with the domain analysis.`
      }],
      temperature: 0.3,
      response_format: { 
        type: "json_object",
        schema: {
          type: "object",
          properties: {
            primary_domain: { 
              type: "string",
              enum: ["cooking", "technology", "fitness", "education", "entertainment", "diy", "business", "health", "travel", "other"]
            },
            domain_keywords: {
              type: "array",
              items: { type: "string" },
              minItems: 5,
              maxItems: 8
            },
            avoid_domains: {
              type: "array",
              items: { type: "string" }
            },
            disambiguation_terms: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["primary_domain", "domain_keywords", "avoid_domains", "disambiguation_terms"]
        }
      }
    });

    return JSON.parse(response.choices[0].message.content || '{}');
  } catch (error) {
    console.error('Error detecting domain:', error);
    // Fallback to generic domain
    return {
      primary_domain: "general",
      domain_keywords: [],
      avoid_domains: [],
      disambiguation_terms: []
    };
  }
}

// Legacy function - removed in favor of LLM-driven expansion

// Legacy function - removed in favor of LLM-driven expansion

// Legacy function - removed in favor of LLM-driven expansion

// Legacy function - removed in favor of LLM-driven expansion

// Legacy function - removed in favor of LLM-driven expansion

async function discoverPatternsWithClaude(
  similarVideos: any[],
  concept: string,
  threadContext?: string
): Promise<{ 
  patterns: DiscoveredPattern[]; 
  prompt: string; 
  usage?: { input_tokens: number; output_tokens: number };
  stats?: { totalVideos: number; performanceDistribution: any; analyzedCount: number }
}> {
  // Now using OpenAI instead of Claude for cost efficiency and JSON mode
  return discoverPatternsWithOpenAI(similarVideos, concept, threadContext);
}

async function discoverPatternsWithOpenAI(
  similarVideos: any[],
  concept: string,
  threadContext?: string
): Promise<{ 
  patterns: DiscoveredPattern[]; 
  prompt: string; 
  usage?: { input_tokens: number; output_tokens: number };
  stats?: { totalVideos: number; performanceDistribution: any; analyzedCount: number }
}> {
  // Get full video data with performance metrics - USE EXISTING PERFORMANCE DATA!
  const videoIds = similarVideos.map(v => v.video_id);
  const { data: videos, error } = await supabase
    .from('videos')
    .select(`
      id, 
      title, 
      view_count, 
      channel_name, 
      published_at,
      performance_ratio,
      outlier_factor,
      first_week_views,
      like_count,
      comment_count,
      channel_avg_views
    `)
    .in('id', videoIds)
    .not('performance_ratio', 'is', null);

  if (error || !videos) {
    console.error('Failed to fetch video data:', error);
    return { patterns: [], prompt: '', usage: undefined, stats: undefined };
  }

  // Enrich with similarity scores and engagement rates
  const enrichedVideos = videos.map(video => ({
    ...video,
    similarity_score: similarVideos.find(sv => sv.video_id === video.id)?.similarity_score || 0,
    engagement_rate: (video.like_count + video.comment_count) / Math.max(video.view_count, 1)
  }));

  // Multi-tier filtering based on performance
  const performanceTiers = {
    superstar: enrichedVideos.filter(v => v.performance_ratio >= 10), // 10x+ channel average
    strong: enrichedVideos.filter(v => v.performance_ratio >= 3 && v.performance_ratio < 10), // 3-10x
    above_avg: enrichedVideos.filter(v => v.performance_ratio >= 1.5 && v.performance_ratio < 3), // 1.5-3x
    normal: enrichedVideos.filter(v => v.performance_ratio < 1.5)
  };

  const performanceDistribution = {
    superstar: performanceTiers.superstar.length,
    strong: performanceTiers.strong.length,
    above_avg: performanceTiers.above_avg.length,
    normal: performanceTiers.normal.length
  };
  
  console.log(`Performance distribution: Superstar: ${performanceDistribution.superstar}, Strong: ${performanceDistribution.strong}, Above Avg: ${performanceDistribution.above_avg}, Normal: ${performanceDistribution.normal}`);

  // Stratified sampling to get diverse but high-performing videos
  // Increased sample size per thread for better pattern evidence
  const selectedVideos = [
    ...performanceTiers.superstar.slice(0, 50).sort((a, b) => b.similarity_score - a.similarity_score),
    ...performanceTiers.strong.slice(0, 60).sort((a, b) => b.similarity_score - a.similarity_score),
    ...performanceTiers.above_avg.slice(0, 50).sort((a, b) => b.similarity_score - a.similarity_score)
  ];

  // If we don't have enough high performers, add some based on pure similarity
  if (selectedVideos.length < 200) {  // Increased from 80 to 200 for more examples per pattern
    const additionalVideos = enrichedVideos
      .filter(v => !selectedVideos.includes(v))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 200 - selectedVideos.length);
    selectedVideos.push(...additionalVideos);
  }

  // Final sort by performance for AI analysis
  const topVideos = selectedVideos.sort((a, b) => b.performance_ratio - a.performance_ratio);

  console.log(`Analyzing ${topVideos.length} videos with OpenAI (increased from 80 to 200 for more examples per pattern)...`);

  // Use OpenAI to discover patterns
  const threadContextInfo = threadContext ? `\n\nAnalysis Context: ${threadContext}\n` : '';
  const prompt = `Analyze these high-performing YouTube video titles about "${concept}" and identify actionable title patterns.${threadContextInfo}

Performance Tiers:
- 🌟 SUPERSTAR (10x+): Videos that massively outperformed their channel average
- 💪 STRONG (3-10x): Proven high performers
- ✅ ABOVE AVG (1.5-3x): Solid performers

Videos (sorted by performance):
${topVideos.slice(0, 200).map((v, i) => {
  const tier = v.performance_ratio >= 10 ? '🌟' : v.performance_ratio >= 3 ? '💪' : '✅';
  const engagement = ` | Engagement: ${(v.engagement_rate * 100).toFixed(2)}%`;
  return `${i + 1}. ${tier} [ID: ${v.id}] "${v.title}" - ${v.performance_ratio.toFixed(1)}x avg (${v.view_count.toLocaleString()} views${engagement})`;
}).join('\n')}

Your task:
1. Identify 3-4 specific, actionable title patterns that appear in MANY videos (at least 10-15 examples each)
2. PRIORITIZE patterns from 🌟 SUPERSTAR videos (10x+ performance) as these represent breakout successes
3. For each pattern, identify ALL video IDs from the list that demonstrate that pattern (more examples = better pattern)
4. Create a template that can be applied to new videos about "${concept}"

Return a JSON object with a "patterns" array:
{
  "patterns": [
    {
      "pattern": "Short descriptive name",
      "explanation": "Why this pattern works",
      "template": "Template with [VARIABLES] that can be filled in",
      "examples": ["Exact title from list", "Another exact title", "Third example", "Fourth example", "Fifth example", "etc... include 10-15 examples"],
      "video_ids": ["video_id_1", "video_id_2", "video_id_3", "etc... include ALL videos that match this pattern (10-15+ preferred)"],
      "confidence": 0.8,
      "performance_multiplier": 3.5
    }
  ]
}

IMPORTANT: 
- Weight patterns based on performance tier - patterns found in 🌟 SUPERSTAR videos should have higher confidence/multiplier
- In the video_ids array, use the exact IDs shown in brackets above
- Only include video IDs from the provided list that actually demonstrate the pattern
- Examples should be exact titles from the videos you reference
- The performance_multiplier should reflect the average performance of videos using this pattern

Focus on:
- Specific words/phrases that appear frequently in top performers
- Title structures that correlate with 10x+ performance
- Emotional hooks or curiosity gaps that drive clicks
- Numbers, lists, or quantifiable elements
- Question formats that create urgency
- Skill level indicators when relevant`;

  try {
    // Use OpenAI with structured output for reliable JSON
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert at analyzing YouTube video titles to discover high-performing patterns. Always return valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { 
        type: "json_object",
        schema: {
          type: "object",
          properties: {
            patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pattern: { type: "string" },
                  explanation: { type: "string" },
                  template: { type: "string" },
                  examples: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 5,
                    maxItems: 15
                  },
                  video_ids: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 5,
                    maxItems: 20
                  },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  performance_multiplier: { type: "number", minimum: 1 }
                },
                required: ["pattern", "explanation", "template", "examples", "video_ids", "confidence", "performance_multiplier"]
              }
            }
          },
          required: ["patterns"]
        }
      }
    });

    const responseText = completion.choices[0].message.content || '{"patterns": []}';
    let parsedResponse;
    
    try {
      parsedResponse = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse OpenAI response as JSON:', e);
      return { patterns: [], prompt, usage: { 
        input_tokens: completion.usage?.prompt_tokens || 0,
        output_tokens: completion.usage?.completion_tokens || 0
      }};
    }

    // Handle both { patterns: [...] } and direct array responses
    const patterns = Array.isArray(parsedResponse) ? parsedResponse : (parsedResponse.patterns || []);
    
    console.log(`✅ OpenAI discovered ${patterns.length} patterns`);
    patterns.forEach(p => {
      console.log(`  - ${p.pattern}: ${p.template} (${p.performance_multiplier}x)`);
    });

    return { 
      patterns, 
      prompt, 
      usage: {
        input_tokens: completion.usage?.prompt_tokens || 0,
        output_tokens: completion.usage?.completion_tokens || 0
      },
      stats: {
        totalVideos: enrichedVideos.length,
        performanceDistribution,
        analyzedCount: topVideos.length
      }
    };
  } catch (error) {
    console.error('Error analyzing patterns:', error);
    return { patterns: [], prompt, usage: undefined, stats: undefined };
  }
}

async function generateTitlesFromPatterns(
  patterns: DiscoveredPattern[], 
  concept: string, 
  options?: TitleGenerationRequest['options']
): Promise<TitleSuggestion[]> {
  const suggestions: TitleSuggestion[] = [];
  
  console.log(`🎯 Processing ${patterns.length} patterns for concept: ${concept}`);
  
  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i];
    
    console.log(`📊 Pattern: ${pattern.pattern} - Performance: ${pattern.performance_multiplier}x`);
    
    // Generate an actual title from the pattern
    const generatedTitle = applyClaudePattern(pattern, concept);
    
    console.log(`🎭 Returning template: ${generatedTitle} from pattern ${pattern.pattern}`);
    
    // Add attribution if pattern has thread info
    const patternWithAttribution = pattern as VerifiedPattern & { source_thread?: string; thread_purpose?: string };
    
    const suggestion: TitleSuggestion = {
      title: generatedTitle,
      pattern: {
        id: `claude_${i}`,
        name: pattern.pattern,
        template: pattern.template,
        performance_lift: pattern.performance_multiplier,
        examples: pattern.examples,
        video_ids: pattern.video_ids || [],
        // Add attribution info if available
        source_thread: patternWithAttribution.source_thread,
        thread_purpose: patternWithAttribution.thread_purpose,
        // Add verification data
        verification: patternWithAttribution.verification
      },
      evidence: {
        sample_size: patternWithAttribution.verification?.matchCount || pattern.video_ids?.length || pattern.examples.length,
        avg_performance: patternWithAttribution.verification?.medianPerformance || pattern.performance_multiplier,
        confidence_score: patternWithAttribution.verification?.verificationScore || pattern.confidence
      },
      explanation: pattern.explanation,
      similarity_score: 0.85 // High similarity since these are from semantic search
    };
    
    suggestions.push(suggestion);
  }
  
  // Sort by performance lift and confidence
  suggestions.sort((a, b) => {
    const scoreA = a.pattern.performance_lift * a.evidence.confidence_score;
    const scoreB = b.pattern.performance_lift * b.evidence.confidence_score;
    return scoreB - scoreA;
  });
  
  console.log(`✅ Generated ${suggestions.length} suggestions`);
  return suggestions;
}

function applyClaudePattern(pattern: DiscoveredPattern, concept: string): string {
  // Intelligent template variable replacement
  const conceptWords = concept.toLowerCase().split(' ');
  
  // Extract key components from the concept
  let skillLevel = '';
  let mainTopic = '';
  let qualifier = '';
  
  // Check for skill level indicators
  const skillLevels = ['beginner', 'intermediate', 'advanced', 'expert', 'newbie', 'pro'];
  for (const word of conceptWords) {
    if (skillLevels.includes(word)) {
      skillLevel = word;
      // Remove skill level from concept words
      const index = conceptWords.indexOf(word);
      conceptWords.splice(index, 1);
      break;
    }
  }
  
  // The main topic is usually the last substantive word
  mainTopic = conceptWords[conceptWords.length - 1];
  qualifier = conceptWords.slice(0, -1).join(' ');
  
  // Common number replacements
  const numbers = ['3', '5', '7', '10', '15'];
  const randomNumber = numbers[Math.floor(Math.random() * numbers.length)];
  
  // Time frames
  const timeframes = ['30 Days', '2 Weeks', '24 Hours', '1 Week', '90 Days'];
  const randomTimeframe = timeframes[Math.floor(Math.random() * timeframes.length)];
  
  // Woodworking-specific replacements
  const woodworkingTypes = ['Joinery', 'Cabinet Making', 'Wood Turning', 'Hand Tool', 'Power Tool', 'Finishing'];
  const woodworkingTools = ['Table Saw', 'Router', 'Planer', 'Band Saw', 'Drill Press', 'Sander'];
  const projectTypes = ['Furniture', 'Cabinet', 'Box', 'Cutting Board', 'Workshop'];
  
  // Smart replacements based on context
  let result = pattern.template;
  
  // Action phrases
  const actionPhrases = ['You Need to Know', 'That Changed Everything', 'Every Beginner Should Have', 'That Save Time', 'Worth Buying'];
  const constraints = ['Under $100', 'You Can Make', 'That Actually Work', 'For Small Shops', 'On a Budget'];
  const toolAspects = ['Features', 'Settings', 'Techniques', 'Skills', 'Tools'];
  const comparisons = ['Good', 'Better', 'Best', 'Right', 'Wrong'];
  const actions = ['Build', 'Make', 'Create', 'Design', 'Craft'];
  
  // Replace based on what's in the template
  result = result
    .replace(/\[CONCEPT\]/g, concept)
    .replace(/\[TOPIC\]/g, mainTopic.charAt(0).toUpperCase() + mainTopic.slice(1))
    .replace(/\[QUALIFIER\]/g, qualifier)
    .replace(/\[NUMBER\]/g, randomNumber)
    .replace(/\[SKILL_LEVEL\]/g, skillLevel || 'Beginner')
    .replace(/\[OUTCOME\]/g, `Master ${mainTopic}`)
    .replace(/\[TIMEFRAME\]/g, randomTimeframe)
    .replace(/\[RESULT\]/g, `${mainTopic} Success`)
    .replace(/\[PROBLEM\]/g, `${mainTopic} Challenges`)
    .replace(/\[SOLUTION\]/g, `${mainTopic} Solutions`)
    .replace(/\[MISTAKES\]/g, 'Mistakes')
    .replace(/\[TIPS\]/g, 'Tips')
    .replace(/\[SECRETS\]/g, 'Secrets')
    .replace(/\[HACKS\]/g, 'Hacks')
    .replace(/\[TRICKS\]/g, 'Tricks')
    .replace(/\[WOODWORKING_TYPE\]/g, woodworkingTypes[Math.floor(Math.random() * woodworkingTypes.length)])
    .replace(/\[TOOL_NAME\]/g, woodworkingTools[Math.floor(Math.random() * woodworkingTools.length)])
    .replace(/\[PROJECT_TYPE\]/g, projectTypes[Math.floor(Math.random() * projectTypes.length)])
    .replace(/\[ACTION_PHRASE\]/g, actionPhrases[Math.floor(Math.random() * actionPhrases.length)])
    .replace(/\[CONSTRAINT\]/g, constraints[Math.floor(Math.random() * constraints.length)])
    .replace(/\[TOOL_ASPECT\]/g, toolAspects[Math.floor(Math.random() * toolAspects.length)])
    .replace(/\[COMPARISON\]/g, comparisons[Math.floor(Math.random() * comparisons.length)])
    .replace(/\[ACTION\]/g, actions[Math.floor(Math.random() * actions.length)]);
    
  // Clean up any weird capitalization issues
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

// Pattern verification system
interface VerifiedPattern extends DiscoveredPattern {
  verification?: {
    matchCount: number;
    medianPerformance: number;
    avgPerformance: number;
    topPerformers: number;
    verificationScore: number;
  };
}

async function findMoreExamplesForPatterns(
  patterns: DiscoveredPattern[],
  allVideos: any[]
): Promise<DiscoveredPattern[]> {
  console.log(`🔍 Finding more examples for ${patterns.length} patterns from ${allVideos.length} videos...`);
  
  return patterns.map(pattern => {
    // Look for more videos that might match this pattern
    const patternKeywords = extractKeywords(pattern.pattern);
    const matchingVideos = allVideos.filter(video => {
      const titleLower = video.title.toLowerCase();
      // Simple keyword matching - look for videos with similar structure
      return patternKeywords.some(keyword => titleLower.includes(keyword.toLowerCase()));
    });
    
    // Get top 15 matching videos as additional examples
    const additionalExamples = matchingVideos
      .sort((a, b) => (b.performance_ratio || 1) - (a.performance_ratio || 1))
      .slice(0, 15)
      .map(v => v.title);
    
    const totalExamples = [...(pattern.examples || []), ...additionalExamples];
    
    console.log(`📊 Pattern "${pattern.pattern}": ${pattern.examples?.length || 0} original + ${additionalExamples.length} additional = ${totalExamples.length} total examples`);
    
    return {
      ...pattern,
      examples: totalExamples
    };
  });
}

function extractKeywords(pattern: string): string[] {
  // Extract meaningful keywords from pattern templates
  const keywords = [];
  
  // Common pattern keywords
  const patternWords = pattern.toLowerCase().match(/\b(how|to|best|top|guide|tips|mistakes|secrets|ultimate|complete|easy|quick|simple|step|ways|methods)\b/g) || [];
  keywords.push(...patternWords);
  
  // Extract words that aren't placeholders
  const nonPlaceholders = pattern.replace(/\[.*?\]/g, '').split(' ').filter(word => 
    word.length > 2 && !['the', 'and', 'for', 'you', 'your', 'are', 'with'].includes(word.toLowerCase())
  );
  keywords.push(...nonPlaceholders);
  
  return [...new Set(keywords)];
}

async function verifyPatternsWithData(
  patterns: DiscoveredPattern[],
  concept: string
): Promise<VerifiedPattern[]> {
  console.log(`🔍 Verifying ${patterns.length} patterns...`);
  
  const verifiedPatterns: VerifiedPattern[] = [];
  
  for (const pattern of patterns) {
    console.log(`🔍 Processing pattern: ${pattern.pattern}`);
    try {
      // 1. Generate 5 actual titles from this pattern
      const sampleTitles: string[] = [];
      for (let i = 0; i < 5; i++) {
        const title = applyClaudePattern(pattern, concept);
        // Add some variation to avoid identical titles
        if (!sampleTitles.includes(title)) {
          sampleTitles.push(title);
        }
      }
      
      if (sampleTitles.length === 0) {
        console.log(`⚠️ Could not generate sample titles for pattern: ${pattern.pattern}`);
        continue;
      }
      
      console.log(`📝 Generated ${sampleTitles.length} sample titles for pattern: ${pattern.pattern}`);
      
      // 2. Create embeddings for each title
      const embeddings: number[][] = [];
      for (const title of sampleTitles) {
        const { embedding } = await embedConcept(title);
        embeddings.push(embedding);
      }
      
      // 3. Calculate centroid (average) of embeddings
      const centroid = calculateCentroid(embeddings);
      
      // 4. Search for similar titles using centroid
      const searchResults = await pineconeService.searchSimilarVideos(
        centroid,
        100,  // Get more results for better statistics
        0.5   // Lower threshold to find more matches
      );
      
      if (searchResults.length === 0) {
        console.log(`❌ No similar titles found for pattern: ${pattern.pattern}`);
        continue;
      }
      
      console.log(`🔍 Found ${searchResults.length} similar titles for pattern: ${pattern.pattern}`);
      
      // 5. Get performance data for matched videos
      const videoIds = searchResults.map(r => r.id);
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title, performance_ratio, view_count, channel_name')
        .in('id', videoIds)
        .not('performance_ratio', 'is', null)
        .gt('performance_ratio', 1.0); // Only count successful videos
      
      if (error || !videos || videos.length < 2) {  // Lowered from 5 to 2
        console.log(`⚠️ Insufficient performance data for pattern: ${pattern.pattern} (${videos?.length || 0} matches with performance data)`);
        continue;
      }
      
      console.log(`📊 Found ${videos.length} videos with performance data for pattern: ${pattern.pattern}`);
      
      // 6. Calculate verification metrics
      const performances = videos.map(v => v.performance_ratio);
      performances.sort((a, b) => a - b);
      
      const medianPerformance = performances[Math.floor(performances.length / 2)];
      const avgPerformance = performances.reduce((a, b) => a + b, 0) / performances.length;
      const topPerformers = performances.filter(p => p >= 10).length;
      
      // 7. Calculate verification score (0-1)
      const verificationScore = calculateVerificationScore(
        videos.length,
        medianPerformance,
        topPerformers
      );
      
      console.log(`✅ Pattern "${pattern.pattern}" verified: ${videos.length} matches, ${medianPerformance.toFixed(1)}x median performance`);
      
      // Add the verification videos to the pattern's examples
      const verificationVideos = videos.slice(0, 15).map(v => v.title); // Top 15 verification videos
      
      verifiedPatterns.push({
        ...pattern,
        examples: [...(pattern.examples || []), ...verificationVideos], // Merge original + verification examples
        verification: {
          matchCount: videos.length,
          medianPerformance,
          avgPerformance,
          topPerformers,
          verificationScore
        }
      });
      
      console.log(`✅ Pattern verified: ${pattern.pattern} - Now has ${pattern.examples?.length || 0} original + ${verificationVideos.length} verification = ${(pattern.examples?.length || 0) + verificationVideos.length} total examples`);
      
    } catch (error) {
      console.error(`Error verifying pattern ${pattern.pattern}:`, error);
    }
  }
  
  // Sort by verification score
  verifiedPatterns.sort((a, b) => {
    const scoreA = (a.verification?.verificationScore || 0) * a.performance_multiplier;
    const scoreB = (b.verification?.verificationScore || 0) * b.performance_multiplier;
    return scoreB - scoreA;
  });
  
  // Filter patterns with very low verification scores (keep most patterns)
  const minVerificationScore = 0.05; // 5% threshold - very permissive
  const filtered = verifiedPatterns.filter(p => 
    p.verification && p.verification.verificationScore >= minVerificationScore
  );
  
  console.log(`✅ Verified ${filtered.length}/${patterns.length} patterns`);
  
  return filtered;
}

function calculateCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  
  const dimensions = embeddings[0].length;
  const centroid = new Array(dimensions).fill(0);
  
  // Sum all embeddings
  for (const embedding of embeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += embedding[i];
    }
  }
  
  // Average
  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

function calculateVerificationScore(
  matchCount: number,
  medianPerformance: number,
  topPerformers: number
): number {
  // Score based on:
  // - Match count (need at least 10 for confidence)
  // - Median performance (higher is better)
  // - Number of top performers (10x+ videos)
  
  const matchScore = Math.min(matchCount / 30, 1); // Max out at 30 matches
  const performanceScore = Math.min((medianPerformance - 1) / 4, 1); // Max out at 5x
  const topPerformerScore = Math.min(topPerformers / 5, 1); // Max out at 5 top performers
  
  // Weighted average
  return (matchScore * 0.3 + performanceScore * 0.5 + topPerformerScore * 0.2);
}

// Removed old pattern application functions - now using Claude's discovered patterns directly

// New LLM-driven thread expansion function
interface ThreadExpansion {
  query: string;
  angle: string;
  intent: string;
}

async function expandThreadsWithLLM(concept: string): Promise<ThreadExpansion[]> {
  try {
    console.log(`🎯 Expanding threads for: "${concept}"`);
    
    const prompt = `Generate 15 diverse thread categories for: "${concept}"

For each thread, create 6 specific search query variations. Each thread should explore a different angle:
- Direct variations (2-3 threads)
- Audience/skill levels (2-3 threads)  
- Content formats (tutorials, reviews, comparisons, mistakes) (3-4 threads)
- Problems/outcomes/benefits (2-3 threads)
- Adjacent/creative angles (2-3 threads)

Return a JSON object with a "threads" array. Each thread should have:
{
  "angle": "brief angle description",
  "intent": "what videos this will find", 
  "queries": ["query1", "query2", "query3", "query4", "query5", "query6"]
}

Example structure:
{
  "threads": [
    {
      "angle": "Direct variations",
      "intent": "Find videos about the exact topic",
      "queries": ["variation1", "variation2", "variation3", "variation4", "variation5", "variation6"]
    }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: prompt
      }],
      response_format: { 
        type: "json_object",
        schema: {
          type: "object",
          properties: {
            threads: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  angle: { type: "string" },
                  intent: { type: "string" },
                  queries: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 5,
                    maxItems: 6
                  }
                },
                required: ["angle", "intent", "queries"]
              }
            }
          },
          required: ["threads"]
        }
      },
      temperature: 0.8,
    });

    const result = JSON.parse(response.choices[0].message.content);
    const threadData = result.threads || [];
    
    // Convert to flat array of individual queries with thread info
    const allQueries: ThreadExpansion[] = [];
    threadData.forEach((thread: any, threadIndex: number) => {
      const queries = thread.queries || [];
      queries.forEach((query: string, queryIndex: number) => {
        allQueries.push({
          query,
          angle: thread.angle,
          intent: thread.intent
        });
      });
    });
    
    console.log(`✅ Generated ${threadData.length} threads with ${allQueries.length} total queries`);
    return allQueries;
    
  } catch (error) {
    console.error('Error in thread expansion:', error);
    // Fallback to original concept if LLM fails
    return [{
      query: concept,
      angle: 'direct',
      intent: 'baseline search'
    }];
  }
}

// Pool-and-cluster implementation
interface PooledVideo {
  video_id: string;
  title: string;
  channel_name: string;
  performance_ratio: number;
  similarity_score: number;
  found_by_threads: Set<string>;
  thread_purposes: Set<string>;
  view_count: number;
}

interface VideoCluster {
  videos: PooledVideo[];
  thread_sources: Set<string>;
  avg_performance: number;
  is_wide: boolean;
  centroid_similarity: number;
}

async function createPooledVideosWithProvenance(
  similarVideos: VideoWithAttribution[], 
  allVideoDetails: any[]
): Promise<PooledVideo[]> {
  // Create map to track which threads found each video
  const videoMap = new Map<string, PooledVideo>();
  
  similarVideos.forEach(video => {
    const details = allVideoDetails?.find(d => d.id === video.video_id);
    
    if (!videoMap.has(video.video_id)) {
      videoMap.set(video.video_id, {
        video_id: video.video_id,
        title: details?.title || 'Unknown',
        channel_name: details?.channel_name || 'Unknown',
        performance_ratio: details?.performance_ratio || 1.0,
        similarity_score: video.similarity_score,
        found_by_threads: new Set(),
        thread_purposes: new Set(),
        view_count: details?.view_count || 0
      });
    }
    
    const pooledVideo = videoMap.get(video.video_id)!;
    pooledVideo.found_by_threads.add(video.thread);
    pooledVideo.thread_purposes.add(video.threadPurpose);
    
    // Keep highest similarity score
    if (video.similarity_score > pooledVideo.similarity_score) {
      pooledVideo.similarity_score = video.similarity_score;
    }
  });
  
  // Filter for performance and return
  return Array.from(videoMap.values())
    .filter(v => v.performance_ratio >= 1.0) // Lowered performance filter to include more videos
    .sort((a, b) => b.performance_ratio - a.performance_ratio);
}

async function clusterVideosByContent(pooledVideos: PooledVideo[]): Promise<VideoCluster[]> {
  // Simple clustering based on title similarity and thread overlap
  const clusters: VideoCluster[] = [];
  const processed = new Set<string>();
  
  for (const video of pooledVideos) {
    if (processed.has(video.video_id)) continue;
    
    // Create new cluster
    const cluster: VideoCluster = {
      videos: [video],
      thread_sources: new Set(video.found_by_threads),
      avg_performance: video.performance_ratio,
      is_wide: false,
      centroid_similarity: video.similarity_score
    };
    
    processed.add(video.video_id);
    
    // Find similar videos for this cluster
    const titleWords = video.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    
    for (const otherVideo of pooledVideos) {
      if (processed.has(otherVideo.video_id)) continue;
      
      // Check for title similarity
      const otherTitleWords = otherVideo.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const commonWords = titleWords.filter(w => otherTitleWords.includes(w));
      
      // Check for thread overlap
      const threadOverlap = Array.from(video.found_by_threads).some(t => 
        otherVideo.found_by_threads.has(t)
      );
      
      // Cluster if similar content or shared threads
      if (commonWords.length >= 2 || threadOverlap) {
        cluster.videos.push(otherVideo);
        otherVideo.found_by_threads.forEach(t => cluster.thread_sources.add(t));
        processed.add(otherVideo.video_id);
      }
    }
    
    // Calculate cluster metrics
    if (cluster.videos.length >= 3) {
      cluster.avg_performance = cluster.videos.reduce((sum, v) => sum + v.performance_ratio, 0) / cluster.videos.length;
      cluster.is_wide = cluster.thread_sources.size >= 3;
      cluster.centroid_similarity = cluster.videos.reduce((sum, v) => sum + v.similarity_score, 0) / cluster.videos.length;
      
      clusters.push(cluster);
    }
  }
  
  // Sort clusters by wide patterns first, then by performance
  return clusters.sort((a, b) => {
    if (a.is_wide !== b.is_wide) return b.is_wide ? 1 : -1;
    return b.avg_performance - a.avg_performance;
  });
}