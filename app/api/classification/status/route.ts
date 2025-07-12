import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Check for recent classification activity (within last 2 minutes)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    
    // Get classification stats
    const { data: recentActivity, error: activityError } = await supabase
      .from('videos')
      .select('classification_timestamp')
      .gte('classification_timestamp', twoMinutesAgo)
      .order('classification_timestamp', { ascending: false })
      .limit(10);
      
    if (activityError) throw activityError;
    
    // Get total counts
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('channel_id', 'is', null);
      
    const { count: classifiedVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('format_type', 'is', null);
    
    // Determine if classification is likely running
    const isLikelyRunning = recentActivity && recentActivity.length > 5;
    const unclassifiedCount = (totalVideos || 0) - (classifiedVideos || 0);
    
    // Calculate progress percentage
    const progressPercentage = totalVideos ? ((classifiedVideos || 0) / totalVideos) * 100 : 0;
    
    // Estimate time remaining based on recent rate
    let estimatedTimeRemaining = null;
    if (isLikelyRunning && recentActivity && recentActivity.length >= 2) {
      const firstTime = new Date(recentActivity[recentActivity.length - 1].classification_timestamp).getTime();
      const lastTime = new Date(recentActivity[0].classification_timestamp).getTime();
      const timeElapsed = (lastTime - firstTime) / 1000; // seconds
      const videosProcessed = recentActivity.length;
      const rate = videosProcessed / timeElapsed; // videos per second
      
      if (rate > 0) {
        const secondsRemaining = unclassifiedCount / rate;
        const hours = Math.floor(secondsRemaining / 3600);
        const minutes = Math.floor((secondsRemaining % 3600) / 60);
        const seconds = Math.floor(secondsRemaining % 60);
        
        if (hours > 0) {
          estimatedTimeRemaining = `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
          estimatedTimeRemaining = `${minutes}m ${seconds}s`;
        } else {
          estimatedTimeRemaining = `${seconds}s`;
        }
      }
    }
    
    return NextResponse.json({
      isLikelyRunning,
      totalVideos: totalVideos || 0,
      classifiedVideos: classifiedVideos || 0,
      unclassifiedVideos: unclassifiedCount,
      progressPercentage,
      estimatedTimeRemaining,
      recentActivityCount: recentActivity?.length || 0,
      lastClassifiedAt: recentActivity?.[0]?.classification_timestamp || null
    });
    
  } catch (error) {
    console.error('Error checking classification status:', error);
    return NextResponse.json(
      { error: 'Failed to check status' },
      { status: 500 }
    );
  }
}