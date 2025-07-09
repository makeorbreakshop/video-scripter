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
    
    return NextResponse.json({
      success: true,
      progress: {
        title: titleProgress,
        thumbnail: thumbnailProgress
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