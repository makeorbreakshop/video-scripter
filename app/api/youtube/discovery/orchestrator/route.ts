/**
 * Discovery Orchestrator
 * Coordinates large-scale channel discovery operations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


interface OrchestratorConfig {
  dailyQuota: {
    searches: number;
    channelValidations: number;
    imports: number;
  };
  autoApproval: {
    enabled: boolean;
    minSubscribers: number;
    minVideos: number;
    minAvgViews: number;
    maxChannelsPerRun: number;
  };
  discovery: {
    searchTypes: ('video' | 'channel' | 'mixed')[];
    batchSize: number;
    concurrency: number;
  };
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  dailyQuota: {
    searches: 100,
    channelValidations: 400,
    imports: 200
  },
  autoApproval: {
    enabled: false, // Disabled for manual review
    minSubscribers: 10000,
    minVideos: 50,
    minAvgViews: 5000,
    maxChannelsPerRun: 100
  },
  discovery: {
    searchTypes: ['video', 'channel', 'mixed'],
    batchSize: 50,
    concurrency: 10
  }
};

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { 
      action = 'full_run',
      config = DEFAULT_CONFIG,
      dryRun = false 
    } = await request.json();

    // Check current quota usage
    const quotaStatus = await checkQuotaStatus();
    if (!quotaStatus.canProceed) {
      return NextResponse.json({
        error: 'Insufficient quota',
        quotaStatus
      }, { status: 429 });
    }

    const startTime = Date.now();
    const results = {
      phase1_discovery: null,
      phase2_validation: null,
      phase3_import: null,
      summary: null
    };

    // Phase 1: Discovery
    if (action === 'full_run' || action === 'discovery_only') {
      results.phase1_discovery = await runDiscoveryPhase(config, dryRun);
    }

    // Phase 2: Validation & Auto-approval
    if (action === 'full_run' || action === 'validation_only') {
      results.phase2_validation = await runValidationPhase(config, dryRun);
    }

    // Phase 3: Import
    if (action === 'full_run' || action === 'import_only') {
      results.phase3_import = await runImportPhase(config, dryRun);
    }

    // Generate summary
    const executionTime = Date.now() - startTime;
    results.summary = {
      action,
      dryRun,
      executionTimeMs: executionTime,
      channelsDiscovered: results.phase1_discovery?.channelsDiscovered || 0,
      channelsApproved: results.phase2_validation?.channelsApproved || 0,
      channelsImported: results.phase3_import?.channelsImported || 0,
      videosImported: results.phase3_import?.totalVideos || 0,
      quotaUsed: calculateTotalQuotaUsed(results)
    };

    // Log run to database
    if (!dryRun) {
      await logOrchestratorRun(results.summary);
    }

    return NextResponse.json({
      success: true,
      ...results
    });

  } catch (error) {
    console.error('Orchestrator error:', error);
    return NextResponse.json({
      error: 'Orchestrator failed',
      details: error.message
    }, { status: 500 });
  }
}

async function runDiscoveryPhase(config: OrchestratorConfig, dryRun: boolean) {
  console.log('🔍 Starting Discovery Phase...');
  
  const results = {
    searchesRun: 0,
    channelsDiscovered: 0,
    newChannels: 0,
    errors: []
  };

  try {
    // Run batch search
    const batchSearchUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/youtube/discovery/batch-search`;
    
    const searchPayload = {
      queryCount: config.dailyQuota.searches,
      queryType: 'mixed',
      autoApprove: config.autoApproval.enabled,
      minSubscribers: config.autoApproval.minSubscribers,
      maxConcurrent: config.discovery.concurrency,
      useGooglePSE: true // Use Google PSE to save YouTube quota!
    };

    if (dryRun) {
      // Simulate results
      results.searchesRun = config.dailyQuota.searches;
      results.channelsDiscovered = Math.floor(config.dailyQuota.searches * 3.5); // Avg 3.5 channels per search
      results.newChannels = Math.floor(results.channelsDiscovered * 0.7); // 70% new
    } else {
      const response = await fetch(batchSearchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(searchPayload)
      });

      if (response.ok) {
        const data = await response.json();
        results.searchesRun = data.summary.queriesExecuted;
        results.channelsDiscovered = data.summary.totalChannelsFound;
        results.newChannels = data.summary.newChannelsAdded;
      } else {
        throw new Error(`Batch search failed: ${response.statusText}`);
      }
    }

    // Also run discovery on existing channels (featured, related, etc.)
    const discoveryMethods = ['featured', 'collaborations', 'shelves'];
    
    for (const method of discoveryMethods) {
      if (dryRun) continue;
      
      try {
        const methodUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/youtube/discovery/${method}`;
        const response = await fetch(methodUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            channelIds: await getTopPerformingChannels(10),
            maxResults: 20 
          })
        });

        if (response.ok) {
          const data = await response.json();
          results.channelsDiscovered += data.channelsDiscovered || 0;
          results.newChannels += data.newChannelsAdded || 0;
        }
      } catch (error) {
        results.errors.push({ method, error: error.message });
      }
    }

  } catch (error) {
    results.errors.push({ phase: 'discovery', error: error.message });
  }

  return results;
}

async function runValidationPhase(config: OrchestratorConfig, dryRun: boolean) {
  console.log('✅ Starting Validation Phase...');
  
  const results = {
    channelsValidated: 0,
    channelsApproved: 0,
    channelsRejected: 0,
    autoApprovalRate: 0
  };

  try {
    // Get pending channels
    const { data: pendingChannels } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('validation_status', 'pending')
      .order('relevance_score', { ascending: false })
      .limit(config.dailyQuota.channelValidations);

    if (!pendingChannels || pendingChannels.length === 0) {
      return results;
    }

    results.channelsValidated = pendingChannels.length;

    // Auto-approve based on criteria
    const approved = [];
    const rejected = [];

    for (const channel of pendingChannels) {
      const metadata = channel.channel_metadata;
      const meetsSubCriteria = (metadata?.subscriber_count || 0) >= config.autoApproval.minSubscribers;
      const meetsVideoCriteria = (metadata?.video_count || 0) >= config.autoApproval.minVideos;
      const avgViews = (metadata?.view_count || 0) / (metadata?.video_count || 1);
      const meetsViewCriteria = avgViews >= config.autoApproval.minAvgViews;
      
      if (meetsSubCriteria && meetsVideoCriteria && meetsViewCriteria) {
        approved.push(channel.discovered_channel_id);
      } else {
        rejected.push({
          id: channel.discovered_channel_id,
          reason: !meetsSubCriteria ? 'low_subscribers' : 
                  !meetsVideoCriteria ? 'low_video_count' : 'low_avg_views'
        });
      }
    }

    results.channelsApproved = approved.length;
    results.channelsRejected = rejected.length;
    results.autoApprovalRate = approved.length / pendingChannels.length;

    if (!dryRun && approved.length > 0) {
      // Update approved channels
      await supabase
        .from('channel_discovery')
        .update({ 
          validation_status: 'approved',
          updated_at: new Date().toISOString()
        })
        .in('discovered_channel_id', approved);
    }

    if (!dryRun && rejected.length > 0) {
      // Update rejected channels with reasons
      for (const reject of rejected) {
        await supabase
          .from('channel_discovery')
          .update({ 
            validation_status: 'rejected',
            rejection_reason: reject.reason,
            updated_at: new Date().toISOString()
          })
          .eq('discovered_channel_id', reject.id);
      }
    }

  } catch (error) {
    console.error('Validation phase error:', error);
  }

  return results;
}

async function runImportPhase(config: OrchestratorConfig, dryRun: boolean) {
  console.log('📥 Starting Import Phase...');
  
  const results = {
    channelsImported: 0,
    totalVideos: 0,
    errors: []
  };

  try {
    // Get approved channels ready for import
    const { data: approvedChannels } = await supabase
      .from('channel_discovery')
      .select('discovered_channel_id')
      .eq('validation_status', 'approved')
      .limit(config.autoApproval.maxChannelsPerRun);

    if (!approvedChannels || approvedChannels.length === 0) {
      return results;
    }

    const channelIds = approvedChannels.map(ch => ch.discovered_channel_id);
    
    if (dryRun) {
      results.channelsImported = channelIds.length;
      results.totalVideos = channelIds.length * 150; // Estimate 150 videos per channel
    } else {
      // Use unified import system
      const importUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/video-import/unified`;
      
      // Process in batches of 10 channels
      const IMPORT_BATCH_SIZE = 10;
      
      for (let i = 0; i < channelIds.length; i += IMPORT_BATCH_SIZE) {
        const batch = channelIds.slice(i, i + IMPORT_BATCH_SIZE);
        
        try {
          const response = await fetch(importUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: 'discovery',
              channelIds: batch,
              options: {
                batchSize: 50,
                skipExports: true
              }
            })
          });

          if (response.ok) {
            const data = await response.json();
            results.channelsImported += batch.length;
            results.totalVideos += data.videosProcessed || 0;

            // Update import status
            await supabase
              .from('channel_discovery')
              .update({ 
                validation_status: 'imported',
                import_status: 'completed',
                imported_at: new Date().toISOString()
              })
              .in('discovered_channel_id', batch);
          }
        } catch (error) {
          results.errors.push({ 
            batch: `${i}-${i + IMPORT_BATCH_SIZE}`,
            error: error.message 
          });
        }
      }
    }

  } catch (error) {
    results.errors.push({ phase: 'import', error: error.message });
  }

  return results;
}

async function checkQuotaStatus() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('youtube_quota_usage')
    .select('quota_used, quota_limit')
    .eq('date', new Date().toISOString().split('T')[0])
    .single();

  const used = data?.quota_used || 0;
  const limit = data?.quota_limit || 10000;
  const remaining = limit - used;

  return {
    canProceed: remaining > 2000, // Need at least 2000 units
    used,
    limit,
    remaining,
    percentUsed: (used / limit) * 100
  };
}

async function getTopPerformingChannels(limit: number): Promise<string[]> {
  const { data } = await supabase
    .from('videos')
    .select('channel_id, view_count')
    .not('channel_id', 'is', null)
    .order('view_count', { ascending: false })
    .limit(limit * 10); // Get more to ensure uniqueness

  const uniqueChannels = new Set<string>();
  for (const video of data || []) {
    uniqueChannels.add(video.channel_id);
    if (uniqueChannels.size >= limit) break;
  }

  return Array.from(uniqueChannels);
}

function calculateTotalQuotaUsed(results: any): number {
  // Rough estimates
  const searchQuota = (results.phase1_discovery?.searchesRun || 0) * 100;
  const validationQuota = (results.phase2_validation?.channelsValidated || 0) * 1;
  const importQuota = (results.phase3_import?.channelsImported || 0) * 10;
  
  return searchQuota + validationQuota + importQuota;
}

async function logOrchestratorRun(summary: any) {
  await supabase.from('discovery_runs').insert({
    run_type: summary.action,
    channels_discovered: summary.channelsDiscovered,
    channels_approved: summary.channelsApproved,
    channels_imported: summary.channelsImported,
    videos_imported: summary.videosImported,
    quota_used: summary.quotaUsed,
    execution_time_ms: summary.executionTimeMs,
    created_at: new Date().toISOString()
  });
}

// GET endpoint to check orchestrator status
export async function GET() {
  const supabase = getSupabase();
  try {
    // Get today's metrics
    const today = new Date().toISOString().split('T')[0];
    
    const { data: metrics } = await supabase
      .from('discovery_metrics')
      .select('*')
      .eq('metric_date', today)
      .single();

    const { data: recentRuns } = await supabase
      .from('discovery_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    const quotaStatus = await checkQuotaStatus();

    return NextResponse.json({
      today: {
        date: today,
        channelsDiscovered: metrics?.channels_discovered || 0,
        channelsImported: metrics?.channels_imported || 0,
        videosImported: metrics?.videos_imported || 0,
        searchesRun: metrics?.total_searches || 0
      },
      quotaStatus,
      recentRuns: recentRuns || [],
      readyForNextRun: quotaStatus.canProceed
    });

  } catch (error) {
    console.error('Error getting orchestrator status:', error);
    return NextResponse.json({
      error: 'Failed to get orchestrator status'
    }, { status: 500 });
  }
}