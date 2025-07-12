/**
 * API Route: Get Categorization Statistics
 * Returns current classification stats for videos
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Get total video count
    const { count: totalVideos, error: totalError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });

    if (totalError) {
      console.error('Error getting total videos:', totalError);
    }

    // Get topic classified count
    const { count: topicClassified, error: topicError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('topic_level_1', 'is', null);

    if (topicError) {
      console.error('Error getting topic classified:', topicError);
    }

    // Get format classified count
    const { count: formatClassified, error: formatError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('format_type', 'is', null);

    if (formatError) {
      console.error('Error getting format classified:', formatError);
    }

    // Get LLM used count
    const { count: llmUsed, error: llmError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('classification_llm_used', true);

    if (llmError) {
      console.error('Error getting LLM used count:', llmError);
    }

    // Get BERTopic clusters count
    const { count: bertopicClusters, error: clustersError } = await supabase
      .from('bertopic_clusters')
      .select('*', { count: 'exact', head: true });

    if (clustersError) {
      console.error('Error getting BERTopic clusters:', clustersError);
    }

    const stats = {
      totalVideos: totalVideos ?? 0,
      topicClassified: topicClassified ?? 0,
      formatClassified: formatClassified ?? 0,
      llmUsed: llmUsed ?? 0,
      bertopicClusters: bertopicClusters ?? 0
    };

    return NextResponse.json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Error getting classification stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get classification stats',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}