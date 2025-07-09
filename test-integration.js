#!/usr/bin/env node

// Test script for unified import integration with queue system
import { createClient } from '@supabase/supabase-js';

// Test unified import request
async function testUnifiedImportQueue() {
  try {
    console.log('🧪 Testing unified import with queue system...');
    
    const testRequest = {
      source: 'competitor',
      videoIds: ['dQw4w9WgXcQ'],
      options: {
        skipEmbeddings: true,
        skipExports: true
      }
    };

    console.log('📋 Test Request:', JSON.stringify(testRequest, null, 2));
    
    // Test the queue system by directly inserting a job
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Insert test job (using existing schema)
    const { data: job, error: jobError } = await supabase
      .from('video_processing_jobs')
      .insert({
        video_id: testRequest.videoIds[0],
        source: testRequest.source,
        status: 'pending',
        metadata: testRequest,
        priority: 2,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (jobError) {
      console.error('❌ Failed to create test job:', jobError);
      return;
    }

    console.log('✅ Test job created successfully:', job.id);
    console.log('📊 Job details:', {
      id: job.id,
      video_id: job.video_id,
      source: job.source,
      status: job.status,
      priority: job.priority,
      created_at: job.created_at
    });

    // Check job status
    const { data: jobStatus, error: statusError } = await supabase
      .from('video_processing_jobs')
      .select('*')
      .eq('id', job.id)
      .single();

    if (statusError) {
      console.error('❌ Failed to get job status:', statusError);
      return;
    }

    console.log('📈 Job status check:', {
      status: jobStatus.status,
      metadata: jobStatus.metadata,
      created_at: jobStatus.created_at
    });

    // Test job status endpoint format
    const statusResponse = {
      jobId: jobStatus.id,
      video_id: jobStatus.video_id,
      source: jobStatus.source,
      status: jobStatus.status,
      priority: jobStatus.priority,
      createdAt: jobStatus.created_at,
      startedAt: jobStatus.started_at,
      completedAt: jobStatus.completed_at,
      workerId: jobStatus.worker_id,
      retryCount: jobStatus.retry_count,
      maxRetries: jobStatus.max_retries,
      errorMessage: jobStatus.error_message,
      metadata: jobStatus.metadata
    };

    // Add unified import specific fields
    if (jobStatus.metadata && jobStatus.metadata.videoIds) {
      const metadata = jobStatus.metadata;
      const estimatedItems = (metadata.videoIds?.length || 0) + 
                           (metadata.channelIds?.length || 0) + 
                           (metadata.rssFeedUrls?.length || 0);
      
      statusResponse.estimatedItems = estimatedItems;
      statusResponse.source = metadata.source;
    }

    console.log('📄 Status endpoint response format:', JSON.stringify(statusResponse, null, 2));
    console.log('🎯 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testUnifiedImportQueue();