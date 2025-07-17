import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';
import { pineconeService } from '@/lib/pinecone-service';
import { supabase } from '@/lib/supabase';
import { AnthropicAPI } from '@/lib/anthropic-api';

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
  try {
    const startTime = Date.now();
    const body: TitleGenerationRequest = await req.json();
    
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

    // 1. Expand queries for broader search
    stepStart = Date.now();
    const expandedQueries = await expandConceptQueries(body.concept);
    const allQueries = [body.concept, ...expandedQueries];
    processingSteps.push({
      step: 'Query Expansion',
      duration_ms: Date.now() - stepStart,
      details: {
        originalQuery: body.concept,
        expandedQueries: expandedQueries.length,
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
    const searchThreshold = 0.25; // Lower threshold for expanded search
    const searchPromises = embeddings.map((embedding, index) => 
      pineconeService.searchSimilar(
        embedding.embedding,
        200, // More results per query
        searchThreshold
      ).then(result => ({
        query: allQueries[index],
        results: result.results
      }))
    );
    
    const searchResults = await Promise.all(searchPromises);
    
    // Deduplicate and merge results
    const videoScoreMap = new Map<string, { video_id: string; similarity_score: number; queries: string[] }>();
    
    searchResults.forEach(({ query, results }) => {
      results.forEach(result => {
        const existing = videoScoreMap.get(result.video_id);
        if (!existing || result.similarity_score > existing.similarity_score) {
          videoScoreMap.set(result.video_id, {
            video_id: result.video_id,
            similarity_score: existing ? Math.max(existing.similarity_score, result.similarity_score) : result.similarity_score,
            queries: existing ? [...existing.queries, query] : [query]
          });
        }
      });
    });
    
    const similarVideos = Array.from(videoScoreMap.values())
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 500); // Take top 500 unique videos
    
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
        totalQueriesSearched: allQueries.length,
        totalResultsFound: Array.from(videoScoreMap.values()).length,
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
        conceptEmbedding,
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
            embeddingLength: conceptEmbedding.length,
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
    
    // Get video details for debug info
    stepStart = Date.now();
    const videoIds = similarVideos.slice(0, 10).map(v => v.video_id);
    const { data: topVideoDetails } = await supabase
      .from('videos')
      .select('id, title, channel_name')
      .in('id', videoIds);
    
    const topVideos = similarVideos.slice(0, 10).map(v => {
      const details = topVideoDetails?.find(d => d.id === v.video_id);
      return {
        id: v.video_id,
        title: details?.title || 'Unknown',
        score: v.similarity_score,
        channel: details?.channel_name || 'Unknown'
      };
    });
    
    processingSteps.push({
      step: 'Fetch Video Details',
      duration_ms: Date.now() - stepStart,
      details: { videosFetched: topVideoDetails?.length || 0 }
    });
    
    // 3. Use Claude to discover patterns from these similar videos
    stepStart = Date.now();
    const { patterns, prompt: claudePrompt, usage: claudeUsage } = await discoverPatternsWithClaude(similarVideos, body.concept);
    
    // Calculate Claude costs (Claude 3.5 Sonnet pricing as of Oct 2024)
    const claudeInputCost = claudeUsage ? (claudeUsage.input_tokens / 1_000_000) * 3.00 : 0;
    const claudeOutputCost = claudeUsage ? (claudeUsage.output_tokens / 1_000_000) * 15.00 : 0;
    const claudeTotalCost = claudeInputCost + claudeOutputCost;
    
    processingSteps.push({
      step: 'Claude Pattern Discovery',
      duration_ms: Date.now() - stepStart,
      details: {
        patternsFound: patterns.length,
        videosAnalyzed: similarVideos.length,
        inputTokens: claudeUsage?.input_tokens,
        outputTokens: claudeUsage?.output_tokens,
        cost: claudeTotalCost
      }
    });
    
    // 4. Generate titles using the discovered patterns
    stepStart = Date.now();
    const suggestions = await generateTitlesFromPatterns(patterns, body.concept, body.options);
    processingSteps.push({
      step: 'Title Generation',
      duration_ms: Date.now() - stepStart,
      details: { titlesGenerated: suggestions.length }
    });
    
    const processingTime = Date.now() - startTime;
    
    const response: TitleGenerationResponse = {
      suggestions: suggestions.slice(0, body.options?.maxSuggestions || 5),
      concept: body.concept,
      total_patterns_searched: patterns.length,
      semantic_neighborhoods_found: 1, // We're using direct similarity now
      processing_time_ms: processingTime,
      debug: {
        embeddingLength: conceptEmbedding.length,
        searchThreshold,
        totalVideosFound: similarVideos.length,
        scoreDistribution,
        topVideos,
        claudePrompt,
        claudePatterns: patterns,
        processingSteps,
        costs: {
          embedding: {
            tokens: totalEmbeddingTokens,
            cost: totalEmbeddingCost
          },
          claude: {
            inputTokens: claudeUsage?.input_tokens || 0,
            outputTokens: claudeUsage?.output_tokens || 0,
            inputCost: claudeInputCost,
            outputCost: claudeOutputCost,
            totalCost: claudeTotalCost
          },
          totalCost: totalEmbeddingCost + claudeTotalCost
        }
      }
    };

    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Error generating titles:', error);
    return NextResponse.json(
      { error: 'Failed to generate titles' },
      { status: 500 }
    );
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

async function expandConceptQueries(concept: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "Generate 6-8 related search queries for YouTube video titles. Return only a JSON array of strings, no explanation."
      }, {
        role: "user",
        content: `Original concept: "${concept}"

Generate semantically related but diverse search queries that would find similar high-performing content from different angles. Include:
- Broader category terms
- More specific niche variations
- Related problems/solutions
- Different skill levels
- Alternative phrasings

Return format: ["query1", "query2", "query3", ...]`
      }],
      temperature: 0.7,
      max_tokens: 200
    });

    const content = response.choices[0].message.content || '[]';
    const queries = JSON.parse(content);
    console.log(`Expanded "${concept}" to: ${queries.join(', ')}`);
    return queries;
  } catch (error) {
    console.error('Error expanding queries:', error);
    return []; // Return empty array on error
  }
}

async function discoverPatternsWithClaude(
  similarVideos: any[],
  concept: string
): Promise<{ patterns: DiscoveredPattern[]; prompt: string; usage?: { input_tokens: number; output_tokens: number } }> {
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
      view_velocity_7d,
      view_velocity_30d,
      first_week_views,
      like_count,
      comment_count,
      channel_avg_views
    `)
    .in('id', videoIds)
    .not('performance_ratio', 'is', null);

  if (error || !videos) {
    console.error('Failed to fetch video data:', error);
    return { patterns: [], prompt: '', usage: undefined };
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

  console.log(`Performance distribution: Superstar: ${performanceTiers.superstar.length}, Strong: ${performanceTiers.strong.length}, Above Avg: ${performanceTiers.above_avg.length}`);

  // Stratified sampling to get diverse but high-performing videos
  const selectedVideos = [
    ...performanceTiers.superstar.slice(0, 10).sort((a, b) => b.similarity_score - a.similarity_score),
    ...performanceTiers.strong.slice(0, 15).sort((a, b) => b.similarity_score - a.similarity_score),
    ...performanceTiers.above_avg.slice(0, 10).sort((a, b) => b.similarity_score - a.similarity_score)
  ];

  // If we don't have enough high performers, add some based on pure similarity
  if (selectedVideos.length < 20) {
    const additionalVideos = enrichedVideos
      .filter(v => !selectedVideos.includes(v))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .slice(0, 20 - selectedVideos.length);
    selectedVideos.push(...additionalVideos);
  }

  // Final sort by performance for Claude
  const topVideos = selectedVideos.sort((a, b) => b.performance_ratio - a.performance_ratio);

  console.log(`Analyzing ${topVideos.length} videos with Claude...`);

  // Use Claude to discover patterns
  const anthropic = new AnthropicAPI();
  const prompt = `Analyze these high-performing YouTube video titles about "${concept}" and identify actionable title patterns.

Performance Tiers:
- 🌟 SUPERSTAR (10x+): Videos that massively outperformed their channel average
- 💪 STRONG (3-10x): Proven high performers
- ✅ ABOVE AVG (1.5-3x): Solid performers

Videos (sorted by performance):
${topVideos.slice(0, 30).map((v, i) => {
  const tier = v.performance_ratio >= 10 ? '🌟' : v.performance_ratio >= 3 ? '💪' : '✅';
  const velocity = v.view_velocity_7d ? ` | 7d velocity: ${v.view_velocity_7d.toFixed(1)}` : '';
  const engagement = ` | Engagement: ${(v.engagement_rate * 100).toFixed(2)}%`;
  return `${i + 1}. ${tier} [ID: ${v.id}] "${v.title}" - ${v.performance_ratio.toFixed(1)}x avg (${v.view_count.toLocaleString()} views${velocity}${engagement})`;
}).join('\n')}

Your task:
1. Identify 3-5 specific, actionable title patterns that are common among these high performers
2. PRIORITIZE patterns from 🌟 SUPERSTAR videos (10x+ performance) as these represent breakout successes
3. For each pattern, identify which video IDs from the list demonstrate that pattern
4. Create a template that can be applied to new videos about "${concept}"

Return a JSON array with this structure:
[
  {
    "pattern": "Short descriptive name",
    "explanation": "Why this pattern works",
    "template": "Template with [VARIABLES] that can be filled in",
    "examples": ["Exact title from list", "Another exact title", "Third example"],
    "video_ids": ["video_id_1", "video_id_2", "video_id_3"],
    "confidence": 0.8,
    "performance_multiplier": 3.5
  }
]

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
    const response = await anthropic.generateText({
      prompt,
      temperature: 0.3,
      maxTokens: 2000
    });

    // Parse the JSON response
    const jsonMatch = response.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('Failed to parse Claude response as JSON');
      return { patterns: [], prompt, usage: response.usage };
    }

    const patterns = JSON.parse(jsonMatch[0]) as DiscoveredPattern[];
    
    console.log(`✅ Claude discovered ${patterns.length} patterns`);
    patterns.forEach(p => {
      console.log(`  - ${p.pattern}: ${p.template} (${p.performance_multiplier}x)`);
    });

    return { patterns, prompt, usage: response.usage };
  } catch (error) {
    console.error('Error analyzing with Claude:', error);
    return { patterns: [], prompt, usage: undefined };
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
    
    // Apply the pattern template to generate a title
    const generatedTitle = applyClaudePattern(pattern, concept);
    
    console.log(`🎭 Generated title: ${generatedTitle} from pattern ${pattern.pattern}`);
    
    const suggestion: TitleSuggestion = {
      title: generatedTitle,
      pattern: {
        id: `claude_${i}`,
        name: pattern.pattern,
        template: pattern.template,
        performance_lift: pattern.performance_multiplier,
        examples: pattern.examples,
        video_ids: pattern.video_ids || []
      },
      evidence: {
        sample_size: pattern.video_ids?.length || pattern.examples.length,
        avg_performance: pattern.performance_multiplier,
        confidence_score: pattern.confidence
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

// Removed old pattern application functions - now using Claude's discovered patterns directly