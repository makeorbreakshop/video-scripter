/**
 * Smart Search Suggestions API Route
 * Uses semantic search to find the most relevant content themes for channel discovery
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';


interface SearchSuggestion {
  term: string;
  source: string;
  confidence: number;
  reasoning: string;
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Get top performing videos to analyze
    const { data: topVideos, error } = await supabase
      .from('videos')
      .select('title, performance_ratio, view_count, channel_name')
      .gt('performance_ratio', 1.5)
      .order('performance_ratio', { ascending: false })
      .limit(20);

    if (error) throw error;

    if (!topVideos || topVideos.length === 0) {
      return NextResponse.json({
        suggestions: [],
        message: 'No high-performing videos found for analysis'
      });
    }

    // Generate semantic-based suggestions
    const suggestions = await generateSemanticSuggestions(topVideos, apiKey);

    return NextResponse.json({
      success: true,
      suggestions,
      analyzedVideos: topVideos.length,
      message: `Generated ${suggestions.length} smart search suggestions using semantic analysis`
    });

  } catch (error) {
    console.error('Error generating smart suggestions:', error);
    return NextResponse.json(
      { error: 'Failed to generate smart search suggestions' },
      { status: 500 }
    );
  }
}

async function generateSemanticSuggestions(topVideos: any[], apiKey: string): Promise<SearchSuggestion[]> {
  const suggestions: SearchSuggestion[] = [];
  
  // Core search themes based on successful content patterns
  const coreThemes = [
    'workshop organization tips',
    'garage storage solutions', 
    'woodworking project ideas',
    'DIY home improvement',
    'tool organization systems',
    'workshop setup guide',
    'small space organization',
    'maker space design',
    'craft room organization',
    'home office setup'
  ];

  // Generate suggestions using semantic search for each theme
  for (const theme of coreThemes) {
    try {
      // Generate embedding for the theme
      const themeEmbedding = await generateQueryEmbedding(theme, apiKey);
      
      // Search for similar content in our database
      const searchResult = await pineconeService.searchSimilar(
        themeEmbedding,
        5, // Limited results per theme
        0.15 // Slightly higher threshold for quality
      );

      // If we have good matches, this theme is relevant
      if (searchResult.results.length > 0) {
        const avgPerformance = searchResult.results.reduce((sum, r) => sum + r.performance_ratio, 0) / searchResult.results.length;
        const avgSimilarity = searchResult.results.reduce((sum, r) => sum + r.similarity_score, 0) / searchResult.results.length;
        
        suggestions.push({
          term: theme,
          source: 'semantic_analysis',
          confidence: Math.min(avgPerformance * avgSimilarity * 10, 10),
          reasoning: `Found ${searchResult.results.length} similar high-performing videos with ${avgPerformance.toFixed(1)}x avg performance`
        });
      }
    } catch (error) {
      console.error(`Error analyzing theme "${theme}":`, error);
    }
  }

  // Generate niche expansion suggestions based on your top video topics
  const expansionThemes = [
    'fitness home gym setup',
    'healthy meal prep organization', 
    'budget-friendly organization',
    'sustainable living tips',
    'productivity workspace design',
    'creative studio organization',
    'minimalist home design',
    'outdoor workspace setup'
  ];

  for (const expansion of expansionThemes) {
    try {
      const expansionEmbedding = await generateQueryEmbedding(expansion, apiKey);
      const searchResult = await pineconeService.searchSimilar(expansionEmbedding, 3, 0.1);
      
      if (searchResult.results.length > 0) {
        const avgSimilarity = searchResult.results.reduce((sum, r) => sum + r.similarity_score, 0) / searchResult.results.length;
        
        suggestions.push({
          term: expansion,
          source: 'niche_expansion',
          confidence: Math.min(avgSimilarity * 8, 10),
          reasoning: `Adjacent niche with ${searchResult.results.length} related videos in your dataset`
        });
      }
    } catch (error) {
      console.error(`Error analyzing expansion "${expansion}":`, error);
    }
  }

  // Extract themes from your actual top-performing titles
  const topTitles = topVideos.slice(0, 5).map(v => v.title);
  for (const title of topTitles) {
    // Generate semantic variations of successful titles
    const titleVariations = generateTitleVariations(title);
    
    for (const variation of titleVariations) {
      if (!suggestions.find(s => s.term === variation)) {
        suggestions.push({
          term: variation,
          source: 'successful_content',
          confidence: 7,
          reasoning: `Variation of your top-performing title: "${title}"`
        });
      }
    }
  }

  // Sort by confidence and return top results
  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12);
}

function generateTitleVariations(title: string): string[] {
  const variations: string[] = [];
  
  // Extract core concepts from the title and create searchable variations
  const concepts = extractCoreConcepts(title);
  
  // Generate variations for each concept
  concepts.forEach(concept => {
    // Add the concept directly
    variations.push(concept);
    
    // Add common search modifiers
    variations.push(`${concept} tutorial`);
    variations.push(`${concept} guide`);
    variations.push(`${concept} tips`);
    variations.push(`${concept} ideas`);
  });
  
  return variations.filter(v => v.length > 8).slice(0, 4); // Limit variations
}

function extractCoreConcepts(title: string): string[] {
  const concepts: string[] = [];
  
  // Look for meaningful phrases that could be search terms
  const titleLower = title.toLowerCase();
  
  // Pattern matching for workshop/DIY concepts
  if (titleLower.includes('workshop')) concepts.push('workshop organization');
  if (titleLower.includes('garage')) concepts.push('garage storage');
  if (titleLower.includes('tool')) concepts.push('tool organization');
  if (titleLower.includes('storage')) concepts.push('storage solutions');
  if (titleLower.includes('organization')) concepts.push('organization systems');
  if (titleLower.includes('build')) concepts.push('DIY build projects');
  if (titleLower.includes('project')) concepts.push('project ideas');
  if (titleLower.includes('woodwork')) concepts.push('woodworking projects');
  if (titleLower.includes('diy')) concepts.push('DIY home improvement');
  if (titleLower.includes('setup')) concepts.push('workspace setup');
  
  return [...new Set(concepts)]; // Remove duplicates
}

