/**
 * YouTube Reporting API Download All Reports Route
 * Downloads all available reports for comprehensive data analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';

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

    console.log('🔍 Getting all available report types and jobs...');

    // Step 1: List all available report types
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
      return NextResponse.json({
        error: 'Failed to list report types',
        details: errorText
      }, { status: 400 });
    }

    const reportTypesData = await reportTypesResponse.json();
    console.log('✅ Available report types:', reportTypesData.reportTypes?.map((rt: any) => rt.id));

    // Step 2: List all existing jobs
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
      return NextResponse.json({
        error: 'Failed to list existing jobs',
        details: errorText
      }, { status: 400 });
    }

    const existingJobsData = await existingJobsResponse.json();
    console.log(`✅ Found ${existingJobsData.jobs?.length || 0} existing jobs`);

    // Step 3: Download reports from ALL jobs
    const zip = new JSZip();
    let totalReports = 0;
    let downloadedReports = 0;

    for (const job of existingJobsData.jobs || []) {
      console.log(`🔍 Checking reports for job: ${job.id} (${job.reportTypeId})`);

      // Get reports for this job
      const reportsResponse = await fetch(
        `https://youtubereporting.googleapis.com/v1/jobs/${job.id}/reports`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!reportsResponse.ok) {
        console.error(`❌ Failed to list reports for job ${job.id}`);
        continue;
      }

      const reportsData = await reportsResponse.json();
      const reports = reportsData.reports || [];
      totalReports += reports.length;

      console.log(`✅ Found ${reports.length} reports for ${job.reportTypeId}`);

      // Download just the most recent report from each job type
      if (reports.length > 0) {
        const report = reports[0]; // Just the most recent report
        console.log(`📥 Downloading latest report for ${job.reportTypeId}: ${report.id}`);

        try {
          const downloadResponse = await fetch(
            report.downloadUrl,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`
              }
            }
          );

          if (downloadResponse.ok) {
            const csvData = await downloadResponse.text();
            
            // Add to ZIP with descriptive filename
            const filename = `${job.reportTypeId}_sample.csv`;
            zip.file(filename, csvData);
            downloadedReports++;
            
            console.log(`✅ Downloaded: ${filename} (${csvData.length} chars)`);
          } else {
            console.error(`❌ Failed to download report ${report.id}`);
          }
        } catch (error) {
          console.error(`❌ Error downloading report ${report.id}:`, error);
        }
      }
    }

    if (downloadedReports === 0) {
      return NextResponse.json({
        message: 'No reports available for download',
        totalJobs: existingJobsData.jobs?.length || 0,
        totalReports: totalReports,
        reportTypes: reportTypesData.reportTypes?.map((rt: any) => rt.id)
      });
    }

    // Generate ZIP file
    console.log(`📦 Creating ZIP with ${downloadedReports} reports...`);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // Return ZIP file
    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="youtube-reports-all-${new Date().toISOString().split('T')[0]}.zip"`
      }
    });

  } catch (error) {
    console.error('❌ Download all reports failed:', error);
    return NextResponse.json(
      { 
        error: 'Download failed', 
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}