import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    
    // This endpoint recalculates the global performance envelope curves
    // In production, this would be a scheduled job
    
    console.log('🚀 Recalculating global performance envelopes...');
    
    const curves = [];
    
    // Calculate percentiles for each day 0-365
    for (let day = 0; day <= 365; day++) {
      const { data: snapshots, error } = await supabase
        .from('view_snapshots')
        .select('view_count')
        .eq('days_since_published', day)
        .not('view_count', 'is', null);
      
      if (error) {
        console.error(`Error fetching day ${day}:`, error);
        continue;
      }
      
      if (!snapshots || snapshots.length < 30) {
        console.log(`Skipping day ${day}: insufficient data (${snapshots?.length || 0} videos)`);
        continue;
      }
      
      // Extract view counts and sort
      const views = snapshots.map(s => s.view_count).sort((a, b) => a - b);
      const count = views.length;
      
      // Calculate percentiles
      const percentiles = {
        p10: views[Math.floor(count * 0.10)],
        p25: views[Math.floor(count * 0.25)],
        p50: views[Math.floor(count * 0.50)],
        p75: views[Math.floor(count * 0.75)],
        p90: views[Math.floor(count * 0.90)],
        p95: views[Math.floor(count * 0.95)]
      };
      
      curves.push({
        day_since_published: day,
        p10_views: percentiles.p10,
        p25_views: percentiles.p25,
        p50_views: percentiles.p50,
        p75_views: percentiles.p75,
        p90_views: percentiles.p90,
        p95_views: percentiles.p95,
        sample_count: count,
        updated_at: new Date().toISOString()
      });
    }
    
    if (curves.length === 0) {
      return NextResponse.json(
        { error: 'No curves generated - insufficient data' },
        { status: 400 }
      );
    }
    
    // Clear existing data and insert new curves
    const { error: deleteError } = await supabase
      .from('performance_envelopes')
      .delete()
      .neq('day_since_published', -1); // Delete all
    
    if (deleteError) {
      console.error('Error clearing table:', deleteError);
      return NextResponse.json(
        { error: 'Failed to clear existing data' },
        { status: 500 }
      );
    }
    
    // Insert in batches
    const batchSize = 100;
    let inserted = 0;
    
    for (let i = 0; i < curves.length; i += batchSize) {
      const batch = curves.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from('performance_envelopes')
        .insert(batch);
      
      if (insertError) {
        console.error(`Error inserting batch:`, insertError);
        continue;
      }
      
      inserted += batch.length;
    }
    
    return NextResponse.json({
      success: true,
      message: `Successfully recalculated performance envelopes`,
      curves_generated: curves.length,
      curves_inserted: inserted,
      sample_data: curves.slice(0, 5).map(c => ({
        day: c.day_since_published,
        median: c.p50_views,
        samples: c.sample_count
      }))
    });
    
  } catch (error) {
    console.error('Error calculating envelopes:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to check current envelope status
export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    
    // Get envelope summary
    const { data: envelopeData, error } = await supabase
      .from('performance_envelopes')
      .select('day_since_published, p50_views, sample_count, updated_at')
      .order('day_since_published')
      .limit(10);
    
    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch envelope data' },
        { status: 500 }
      );
    }
    
    // Get last update time
    const { data: lastUpdate } = await supabase
      .from('performance_envelopes')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();
    
    // Get total days covered
    const { count } = await supabase
      .from('performance_envelopes')
      .select('*', { count: 'exact', head: true });
    
    return NextResponse.json({
      status: 'ready',
      total_days: count || 0,
      last_updated: lastUpdate?.updated_at || null,
      sample_curves: envelopeData,
      description: 'Performance envelope curves are ready for use'
    });
    
  } catch (error) {
    console.error('Error checking envelope status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}