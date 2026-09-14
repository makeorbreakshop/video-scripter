import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { vectorizationProgressCache } from '@/lib/simple-cache';
import { q } from '@/lib/admin/db';
import { SUMMARY_VECTORIZATION_TOTAL_SQL, SUMMARY_VECTORIZATION_DONE_SQL } from '@/lib/app/video-text-routes';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Check cache first
    const cacheKey = 'vectorization-progress';
    const cached = vectorizationProgressCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
    // Get title vectorization progress - optimize by selecting only id
    const [titleTotal, titleDone] = await Promise.all([
      supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .not('title', 'is', null),
      supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('pinecone_embedded', true)
        .not('title', 'is', null)
    ]);
    
    // Get thumbnail vectorization progress - optimize by selecting only id
    const [thumbnailTotal, thumbnailDone] = await Promise.all([
      supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .not('thumbnail_url', 'is', null),
      supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('embedding_thumbnail_synced', true)
        .not('thumbnail_url', 'is', null)
    ]);
    
    // Get LLM summary vectorization progress. Counted over video_text: `.not('llm_summary',
    // 'is', null)` on `videos` reports zero summaries the moment the null-out has run, so the
    // bar would read 0/0 rather than complete. The embedding flag stays on `videos`.
    const [llmSummaryTotalRows, llmSummaryDoneRows] = await Promise.all([
      q<{ count: number }>(SUMMARY_VECTORIZATION_TOTAL_SQL),
      q<{ count: number }>(SUMMARY_VECTORIZATION_DONE_SQL),
    ]);
    const llmSummaryTotal = { count: llmSummaryTotalRows[0]?.count ?? 0 };
    const llmSummaryDone = { count: llmSummaryDoneRows[0]?.count ?? 0 };
    
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
    
    const responseData = {
      success: true,
      progress: {
        title: titleProgress,
        thumbnail: thumbnailProgress,
        llmSummary: llmSummaryProgress
      }
    };
    
    // Cache the response
    vectorizationProgressCache.set(cacheKey, responseData);
    
    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error getting vectorization progress:', error);
    return NextResponse.json(
      { error: 'Failed to get progress' },
      { status: 500 }
    );
  }
}