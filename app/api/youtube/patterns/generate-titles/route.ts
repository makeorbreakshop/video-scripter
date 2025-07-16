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
}

export async function POST(req: NextRequest) {
  try {
    const startTime = Date.now();
    const body: TitleGenerationRequest = await req.json();
    
    if (!body.concept) {
      return NextResponse.json({ error: 'Concept is required' }, { status: 400 });
    }

    console.log('🎯 Generating titles for concept:', body.concept);

    // 1. Embed the user's concept
    const conceptEmbedding = await embedConcept(body.concept);
    
    // 2. Find semantically similar videos using real Pinecone search
    const { results: similarVideos } = await pineconeService.searchSimilar(
      conceptEmbedding,
      100, // Get more videos for better pattern discovery
      0.7  // Minimum similarity threshold
    );
    
    if (similarVideos.length === 0) {
      return NextResponse.json({
        suggestions: [],
        concept: body.concept,
        total_patterns_searched: 0,
        semantic_neighborhoods_found: 0,
        processing_time_ms: Date.now() - startTime
      });
    }
    
    console.log(`Found ${similarVideos.length} similar videos for pattern discovery`);
    
    // 3. Use Claude to discover patterns from these similar videos
    const patterns = await discoverPatternsWithClaude(similarVideos, body.concept);
    
    // 4. Generate titles using the discovered patterns
    const suggestions = await generateTitlesFromPatterns(patterns, body.concept, body.options);
    
    const processingTime = Date.now() - startTime;
    
    const response: TitleGenerationResponse = {
      suggestions: suggestions.slice(0, body.options?.maxSuggestions || 5),
      concept: body.concept,
      total_patterns_searched: patterns.length,
      semantic_neighborhoods_found: 1, // We're using direct similarity now
      processing_time_ms: processingTime
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

async function embedConcept(concept: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: concept,
    dimensions: 512
  });
  
  return response.data[0].embedding;
}

async function discoverPatternsWithClaude(
  similarVideos: any[],
  concept: string
): Promise<DiscoveredPattern[]> {
  // Get full video data with performance metrics
  const videoIds = similarVideos.map(v => v.video_id);
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, view_count, channel_name, published_at')
    .in('id', videoIds);

  if (error || !videos) {
    console.error('Failed to fetch video data:', error);
    return [];
  }

  // Calculate performance ratios for each channel
  const channelNames = [...new Set(videos.map(v => v.channel_name))];
  const channelBaselines: Record<string, number> = {};
  
  for (const channelName of channelNames) {
    const { data: channelVideos } = await supabase
      .from('videos')
      .select('view_count')
      .eq('channel_name', channelName)
      .gte('published_at', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .not('view_count', 'is', null);

    if (channelVideos && channelVideos.length > 0) {
      const avgViews = channelVideos.reduce((sum, v) => sum + v.view_count, 0) / channelVideos.length;
      channelBaselines[channelName] = avgViews;
    }
  }

  // Enrich videos with performance ratios
  const enrichedVideos = videos.map(video => ({
    ...video,
    performance_ratio: channelBaselines[video.channel_name] 
      ? video.view_count / channelBaselines[video.channel_name]
      : 1.0,
    similarity_score: similarVideos.find(sv => sv.video_id === video.id)?.similarity_score || 0
  }));

  // Sort by performance and take top performers
  const topVideos = enrichedVideos
    .filter(v => v.performance_ratio >= 1.5) // At least 1.5x channel average
    .sort((a, b) => b.performance_ratio - a.performance_ratio)
    .slice(0, 30); // Analyze top 30

  if (topVideos.length < 5) {
    console.log('Not enough high-performing videos for pattern analysis');
    // Fallback to top videos by similarity
    topVideos.push(
      ...enrichedVideos
        .sort((a, b) => b.similarity_score - a.similarity_score)
        .slice(0, 20)
    );
  }

  console.log(`Analyzing ${topVideos.length} videos with Claude...`);

  // Use Claude to discover patterns
  const anthropic = new AnthropicAPI();
  const prompt = `Analyze these high-performing YouTube video titles about "${concept}" and identify actionable title patterns.

Videos (sorted by performance):
${topVideos.slice(0, 20).map((v, i) => `${i + 1}. "${v.title}" - ${v.performance_ratio.toFixed(1)}x channel average (${v.view_count.toLocaleString()} views, similarity: ${(v.similarity_score * 100).toFixed(0)}%)`).join('\n')}

Your task:
1. Identify 3-5 specific, actionable title patterns that are common among these high performers
2. Focus on patterns that can be applied to new videos about "${concept}"
3. Each pattern should have a template with variables

Return a JSON array of patterns with this structure:
[
  {
    "pattern": "Short descriptive name",
    "explanation": "Why this pattern works",
    "template": "Template with [VARIABLES]",
    "examples": ["Example 1", "Example 2", "Example 3"],
    "confidence": 0.8,
    "performance_multiplier": 3.5
  }
]

Focus on:
- Specific words/phrases that appear frequently
- Title structures and formats  
- Emotional hooks or curiosity gaps
- Numbers, lists, or quantifiable elements
- Question formats
- Skill level indicators

Be specific and actionable. Templates should use variables like [NUMBER], [SKILL_LEVEL], [OUTCOME], [TIMEFRAME], etc.`;

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
      return [];
    }

    const patterns = JSON.parse(jsonMatch[0]) as DiscoveredPattern[];
    
    console.log(`✅ Claude discovered ${patterns.length} patterns`);
    patterns.forEach(p => {
      console.log(`  - ${p.pattern}: ${p.template} (${p.performance_multiplier}x)`);
    });

    return patterns;
  } catch (error) {
    console.error('Error analyzing with Claude:', error);
    return [];
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
        examples: pattern.examples
      },
      evidence: {
        sample_size: 20, // We analyzed top 20 videos
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
    .replace(/\[PROJECT_TYPE\]/g, projectTypes[Math.floor(Math.random() * projectTypes.length)]);
    
  // Clean up any weird capitalization issues
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

// Removed old pattern application functions - now using Claude's discovered patterns directly