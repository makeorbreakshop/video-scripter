/**
 * API Route: Get Categorization System Status
 * Checks if BERTopic clusters are loaded and system is ready
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Check if BERTopic clusters are loaded
    const { count: clusterCount, error: clusterError } = await supabase
      .from('bertopic_clusters')
      .select('*', { count: 'exact', head: true });

    if (clusterError) {
      console.error('Error checking BERTopic clusters:', clusterError);
    }

    // Check database columns exist
    const { data: columns, error: columnsError } = await supabase
      .from('videos')
      .select('topic_level_1, topic_level_2, topic_level_3, format_primary, format_confidence')
      .limit(1);

    const databaseColumnsExist = !columnsError;

    // Return system status
    const systemStatus = {
      bertopicDataLoaded: (clusterCount ?? 0) > 0,
      bertopicClusters: clusterCount ?? 0,
      databaseColumns: databaseColumnsExist,
      testSystemReady: true // Format detection is always ready
    };

    return NextResponse.json({
      success: true,
      status: systemStatus
    });

  } catch (error) {
    console.error('Error checking system status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check system status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}