import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { openai } from '@/lib/openai-client';

export async function POST(request: Request) {
  console.log('🔮 Pattern Prediction API called');
  
  try {
    const body = await request.json();
    const {
      title,
      format,
      niche,
      duration,
      topic_cluster
    } = body;

    console.log('Pattern prediction request:', {
      title,
      format,
      niche,
      duration,
      topic_cluster
    });

    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    // Generate embedding for the title
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: title,
      dimensions: 512
    });
    
    const titleEmbedding = embeddingResponse.data[0].embedding;

    // Find relevant patterns
    const relevantPatterns = await findRelevantPatterns(title, format, topic_cluster);

    // Calculate prediction score
    const predictions = await calculatePredictions(relevantPatterns, {
      title,
      format,
      niche,
      duration,
      topic_cluster
    });

    // Generate suggestions
    const suggestions = generateSuggestions(relevantPatterns, predictions);

    return NextResponse.json({
      success: true,
      predicted_performance: predictions.overall_score,
      matching_patterns: relevantPatterns.slice(0, 5),
      suggestions,
      analysis: {
        title_score: predictions.title_score,
        format_score: predictions.format_score,
        duration_score: predictions.duration_score,
        timing_score: predictions.timing_score,
        confidence: predictions.confidence
      }
    });

  } catch (error) {
    console.error('Pattern prediction error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to predict performance',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function findRelevantPatterns(title: string, format?: string, topic_cluster?: string) {
  let query = supabase
    .from('patterns')
    .select(`
      id,
      pattern_type,
      pattern_data,
      performance_stats,
      created_at
    `)
    .order('created_at', { ascending: false });

  // Filter by format if provided
  if (format) {
    query = query.or(`pattern_type.eq.format,pattern_data->format.eq.${format}`);
  }

  // Filter by topic cluster if provided
  if (topic_cluster) {
    query = query.contains('pattern_data', { context: topic_cluster });
  }

  const { data: patterns, error } = await query;

  if (error) {
    console.error('Error fetching patterns:', error);
    return [];
  }

  // Score patterns by relevance to title
  const scoredPatterns = (patterns || []).map(pattern => {
    let relevanceScore = 0;

    // Title pattern matching
    if (pattern.pattern_type === 'title') {
      const patternNgram = pattern.pattern_data.ngram?.toLowerCase();
      const titleLower = title.toLowerCase();
      
      if (patternNgram && titleLower.includes(patternNgram)) {
        relevanceScore += 10;
      }
    }

    // Format matching
    if (pattern.pattern_type === 'format' && pattern.pattern_data.format === format) {
      relevanceScore += 8;
    }

    // Duration matching
    if (pattern.pattern_type === 'duration') {
      // Could add duration matching logic here
      relevanceScore += 5;
    }

    // Topic cluster matching
    if (pattern.pattern_data.context === topic_cluster) {
      relevanceScore += 6;
    }

    return {
      ...pattern,
      relevance_score: relevanceScore
    };
  });

  return scoredPatterns
    .filter(p => p.relevance_score > 0)
    .sort((a, b) => b.relevance_score - a.relevance_score);
}

async function calculatePredictions(patterns: any[], videoData: any) {
  let titleScore = 1.0;
  let formatScore = 1.0;
  let durationScore = 1.0;
  let timingScore = 1.0;
  let confidence = 0.5;

  // Calculate scores based on matching patterns
  for (const pattern of patterns) {
    const patternPerformance = pattern.performance_stats.avg || 1.0;
    const patternConfidence = pattern.pattern_data.confidence || 0.5;

    switch (pattern.pattern_type) {
      case 'title':
        titleScore = Math.max(titleScore, patternPerformance);
        confidence = Math.max(confidence, patternConfidence);
        break;
      case 'format':
        formatScore = Math.max(formatScore, patternPerformance);
        confidence = Math.max(confidence, patternConfidence);
        break;
      case 'duration':
        durationScore = Math.max(durationScore, patternPerformance);
        confidence = Math.max(confidence, patternConfidence);
        break;
      case 'timing':
        timingScore = Math.max(timingScore, patternPerformance);
        confidence = Math.max(confidence, patternConfidence);
        break;
    }
  }

  // Calculate overall score (weighted average)
  const overallScore = (
    titleScore * 0.4 +
    formatScore * 0.3 +
    durationScore * 0.2 +
    timingScore * 0.1
  );

  return {
    overall_score: overallScore,
    title_score: titleScore,
    format_score: formatScore,
    duration_score: durationScore,
    timing_score: timingScore,
    confidence: Math.min(confidence, 1.0)
  };
}

function generateSuggestions(patterns: any[], predictions: any): string[] {
  const suggestions: string[] = [];

  // Title suggestions
  const titlePatterns = patterns.filter(p => p.pattern_type === 'title');
  if (titlePatterns.length > 0) {
    const bestTitle = titlePatterns[0];
    if (bestTitle.performance_stats.avg > 2.0) {
      suggestions.push(`Consider adding "${bestTitle.pattern_data.ngram}" to your title for ${bestTitle.performance_stats.avg.toFixed(1)}x boost`);
    }
  }

  // Format suggestions
  const formatPatterns = patterns.filter(p => p.pattern_type === 'format');
  if (formatPatterns.length > 0) {
    const bestFormat = formatPatterns[0];
    if (bestFormat.performance_stats.avg > 2.0) {
      suggestions.push(`"${bestFormat.pattern_data.format}" format shows ${bestFormat.performance_stats.avg.toFixed(1)}x performance in this niche`);
    }
  }

  // Duration suggestions
  const durationPatterns = patterns.filter(p => p.pattern_type === 'duration');
  if (durationPatterns.length > 0) {
    const bestDuration = durationPatterns[0];
    suggestions.push(`Optimal duration for your niche: ${bestDuration.pattern_data.duration_range}`);
  }

  // Timing suggestions
  const timingPatterns = patterns.filter(p => p.pattern_type === 'timing');
  if (timingPatterns.length > 0) {
    const bestTiming = timingPatterns[0];
    suggestions.push(`${bestTiming.pattern_data.day_of_week} uploads perform ${bestTiming.performance_stats.avg.toFixed(1)}x better`);
  }

  // Performance warnings
  if (predictions.overall_score < 1.5) {
    suggestions.push('⚠️ Consider reviewing title and format - current prediction below average');
  }

  if (predictions.confidence < 0.7) {
    suggestions.push('⚠️ Low confidence prediction - limited data for this combination');
  }

  return suggestions;
}