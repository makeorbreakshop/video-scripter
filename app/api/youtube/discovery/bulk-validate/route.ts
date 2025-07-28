import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { channelIds, action, autoImport = false } = await request.json();

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json(
        { error: 'channelIds array is required' },
        { status: 400 }
      );
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    const { data, error } = await supabase
      .from('channel_discovery')
      .update({ 
        validation_status: newStatus,
        updated_at: new Date().toISOString()
      })
      .in('discovered_channel_id', channelIds)
      .eq('validation_status', 'pending')
      .select('id, discovered_channel_id, channel_metadata');

    if (error) {
      throw error;
    }

    // Log the bulk action
    console.log(`✅ Bulk ${action}: ${data?.length || 0} channels updated`);

    let importResults = null;

    // Auto-import if requested and action is approve
    if (autoImport && action === 'approve' && data && data.length > 0) {
      try {
        const approvedChannelIds = data.map(ch => ch.discovered_channel_id);
        
        console.log(`🚀 Auto-importing ${approvedChannelIds.length} approved channels...`);
        
        // Use unified import system
        const baseUrl = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '');
        const importResponse = await fetch(`${baseUrl}/api/video-import/unified`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'discovery',
            channelIds: approvedChannelIds,
            options: {
              batchSize: 50,
              skipExports: true
            }
          })
        });

        if (importResponse.ok) {
          const importData = await importResponse.json();
          importResults = {
            channelsProcessed: approvedChannelIds.length,
            jobId: importData.jobId,
            status: importData.status,
            statusUrl: importData.statusUrl,
            success: true
          };

          // Update import status to queued (will be updated when job completes)
          await supabase
            .from('channel_discovery')
            .update({ 
              validation_status: 'approved', // Keep as approved until job completes
              import_status: 'queued',
              import_job_id: importData.jobId,
              updated_at: new Date().toISOString()
            })
            .in('discovered_channel_id', approvedChannelIds);

          console.log(`✅ Auto-import queued: Job ${importData.jobId} created for ${approvedChannelIds.length} channels`);
        } else {
          const errorText = await importResponse.text();
          importResults = {
            success: false,
            error: `Import failed: ${errorText}`
          };
        }
      } catch (importError) {
        console.error('Auto-import error:', importError);
        importResults = {
          success: false,
          error: 'Import failed with exception'
        };
      }
    }

    return NextResponse.json({
      success: true,
      action,
      updatedChannels: data?.length || 0,
      channelIds: data?.map(ch => ch.discovered_channel_id) || [],
      message: `Successfully ${action}d ${data?.length || 0} channels`,
      autoImport: autoImport && action === 'approve',
      importResults
    });

  } catch (error) {
    console.error('Bulk validation error:', error);
    return NextResponse.json(
      { error: 'Failed to perform bulk validation' },
      { status: 500 }
    );
  }
}