/**
 * YouTube Reporting API Download Route
 * Downloads CSV reports from YouTube Reporting API
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token required' },
        { status: 401 }
      );
    }

    console.log('🔍 First, listing available report types...');

    // Step 1: List available report types to find the correct one
    const reportTypesResponse = await fetch(
      'https://youtubereporting.googleapis.com/v1/reportTypes',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!reportTypesResponse.ok) {
      const errorText = await reportTypesResponse.text();
      console.error('❌ List report types failed:', errorText);
      return NextResponse.json({
        error: 'Failed to list report types',
        details: errorText
      }, { status: 400 });
    }

    const reportTypesData = await reportTypesResponse.json();
    console.log('✅ Available report types:', reportTypesData.reportTypes?.map((rt: any) => rt.id));

    // Find a suitable report type for channel/video data
    const videoReportType = reportTypesData.reportTypes?.find((rt: any) => 
      rt.id.includes('channel') && (rt.id.includes('basic') || rt.id.includes('video'))
    );

    if (!videoReportType) {
      return NextResponse.json({
        error: 'No suitable video report type found',
        availableTypes: reportTypesData.reportTypes?.map((rt: any) => rt.id)
      }, { status: 400 });
    }

    console.log(`🔍 Using report type: ${videoReportType.id}`);

    // Step 2: List existing jobs first (don't create new ones unnecessarily)
    console.log('🔍 Checking for existing jobs...');
    const existingJobsResponse = await fetch(
      'https://youtubereporting.googleapis.com/v1/jobs',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!existingJobsResponse.ok) {
      const errorText = await existingJobsResponse.text();
      console.error('❌ List existing jobs failed:', errorText);
      return NextResponse.json({
        error: 'Failed to list existing jobs',
        details: errorText
      }, { status: 400 });
    }

    const existingJobsData = await existingJobsResponse.json();
    console.log(`✅ Found ${existingJobsData.jobs?.length || 0} existing jobs`);

    // Look for a job with our desired report type
    let targetJob = existingJobsData.jobs?.find((job: any) => 
      job.reportTypeId === videoReportType.id
    );

    // If no job exists, try to create one
    if (!targetJob) {
      console.log(`🔍 Creating new job for report type: ${videoReportType.id}`);
      
      const createJobResponse = await fetch(
        'https://youtubereporting.googleapis.com/v1/jobs',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            reportTypeId: videoReportType.id,
            name: `Auto-generated job for ${videoReportType.id}`
          })
        }
      );

      if (!createJobResponse.ok) {
        const errorText = await createJobResponse.text();
        console.error('❌ Create job failed:', errorText);
        
        // If we can't create a job, just use any existing job for now
        if (existingJobsData.jobs && existingJobsData.jobs.length > 0) {
          targetJob = existingJobsData.jobs[0];
          console.log(`⚠️ Using existing job: ${targetJob.id} (${targetJob.reportTypeId})`);
        } else {
          return NextResponse.json({
            error: 'Failed to create reporting job and no existing jobs found',
            details: errorText,
            availableReportTypes: reportTypesData.reportTypes?.map((rt: any) => rt.id)
          }, { status: 400 });
        }
      } else {
        targetJob = await createJobResponse.json();
        console.log('✅ Job created:', targetJob.id);
      }
    } else {
      console.log(`✅ Using existing job: ${targetJob.id}`);
    }

    // Step 3: List available reports for this job
    console.log('🔍 Listing available reports...');
    const reportsResponse = await fetch(
      `https://youtubereporting.googleapis.com/v1/jobs/${targetJob.id}/reports`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!reportsResponse.ok) {
      const errorText = await reportsResponse.text();
      console.error('❌ List reports failed:', errorText);
      return NextResponse.json({
        error: 'Failed to list reports',
        details: errorText
      }, { status: 400 });
    }

    const reportsData = await reportsResponse.json();
    console.log(`✅ Found ${reportsData.reports?.length || 0} reports`);

    if (!reportsData.reports || reportsData.reports.length === 0) {
      return NextResponse.json({
        message: 'No reports available yet. Reports are generated daily.',
        jobId: targetJob.id,
        reportType: targetJob.reportTypeId,
        existingJobs: existingJobsData.jobs?.map((job: any) => ({
          id: job.id,
          reportTypeId: job.reportTypeId,
          name: job.name
        }))
      });
    }

    // Step 4: Download the most recent report
    const latestReport = reportsData.reports[0];
    console.log('📥 Downloading report:', latestReport.id);

    const downloadResponse = await fetch(
      latestReport.downloadUrl,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    if (!downloadResponse.ok) {
      const errorText = await downloadResponse.text();
      console.error('❌ Download failed:', errorText);
      return NextResponse.json({
        error: 'Failed to download report',
        details: errorText
      }, { status: 400 });
    }

    const csvData = await downloadResponse.text();
    console.log(`✅ Downloaded ${csvData.length} characters of CSV data`);

    // Return the CSV data
    return new Response(csvData, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="youtube-report-${latestReport.id}.csv"`
      }
    });

  } catch (error) {
    console.error('❌ Download report failed:', error);
    return NextResponse.json(
      { 
        error: 'Download failed', 
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}