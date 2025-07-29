import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get title vectorization progress
    const [titleTotal, titleDone] = await Promise.all([
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .not('title', 'is', null),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('pinecone_embedded', true)
        .not('title', 'is', null)
    ]);
    
    // Get thumbnail vectorization progress
    const [thumbnailTotal, thumbnailDone] = await Promise.all([
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .not('thumbnail_url', 'is', null),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('embedding_thumbnail_synced', true)
        .not('thumbnail_url', 'is', null)
    ]);
    
    // Get LLM summary vectorization progress
    const [llmSummaryTotal, llmSummaryDone] = await Promise.all([
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .not('llm_summary', 'is', null),
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('llm_summary_embedding_synced', true)
        .not('llm_summary', 'is', null)
    ]);
    
    const titleProgress = {
      total: titleTotal.count || 0,
      completed: titleDone.count || 0,
      remaining: (titleTotal.count || 0) - (titleDone.count || 0),
      percentage: titleTotal.count ? Math.round(((titleDone.count || 0) / titleTotal.count) * 100) : 0
    };
    
    const thumbnailProgress = {
      total: thumbnailTotal.count || 0,
      completed: thumbnailDone.count || 0,
      remaining: (thumbnailTotal.count || 0) - (thumbnailDone.count || 0),
      percentage: thumbnailTotal.count ? Math.round(((thumbnailDone.count || 0) / thumbnailTotal.count) * 100) : 0
    };
    
    const llmSummaryProgress = {
      total: llmSummaryTotal.count || 0,
      completed: llmSummaryDone.count || 0,
      remaining: (llmSummaryTotal.count || 0) - (llmSummaryDone.count || 0),
      percentage: llmSummaryTotal.count ? Math.round(((llmSummaryDone.count || 0) / llmSummaryTotal.count) * 100) : 0
    };
    
    return NextResponse.json({
      success: true,
      progress: {
        title: titleProgress,
        thumbnail: thumbnailProgress,
        llmSummary: llmSummaryProgress
      }
    });
  } catch (error) {
    console.error('Error getting vectorization progress:', error);
    return NextResponse.json(
      { error: 'Failed to get progress' },
      { status: 500 }
    );
  }
}