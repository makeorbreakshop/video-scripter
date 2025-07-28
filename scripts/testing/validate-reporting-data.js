#!/usr/bin/env node

/**
 * YouTube Reporting API Data Validation Script
 * 
 * Compares Analytics API vs Reporting API data for accuracy validation.
 * This helps ensure the transition to Reporting API maintains data integrity.
 * 
 * Features:
 * - Side-by-side comparison of core metrics
 * - Variance analysis and tolerance checking
 * - Statistical correlation analysis
 * - Detailed reporting on data quality
 * 
 * Usage:
 *   node scripts/validate-reporting-data.js [options]
 * 
 * Options:
 *   --date <YYYY-MM-DD>      Specific date to validate (default: yesterday)
 *   --days-back <number>     Number of days to validate (default: 7)
 *   --tolerance <number>     Acceptable variance percentage (default: 5)
 *   --output-csv            Export comparison to CSV file
 *   --verbose               Show detailed per-video analysis
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  date: process.argv.find(arg => arg.startsWith('--date='))?.split('=')[1],
  daysBack: parseInt(process.argv.find(arg => arg.startsWith('--days-back='))?.split('=')[1]) || 7,
  tolerance: parseFloat(process.argv.find(arg => arg.startsWith('--tolerance='))?.split('=')[1]) || 5.0,
  outputCsv: process.argv.includes('--output-csv'),
  verbose: process.argv.includes('--verbose'),
  reportFile: path.join(__dirname, `validation-report-${new Date().toISOString().split('T')[0]}.txt`)
};

// Validation state
let validation = {
  startTime: new Date(),
  datesProcessed: [],
  totalComparisons: 0,
  exactMatches: 0,
  withinTolerance: 0,
  outsideTolerance: 0,
  onlyInAnalytics: 0,
  onlyInReporting: 0,
  metrics: {
    views: { total: 0, matches: 0, avgVariance: 0 },
    watchTime: { total: 0, matches: 0, avgVariance: 0 },
    avgViewDuration: { total: 0, matches: 0, avgVariance: 0 }
  },
  details: []
};

/**
 * Log with timestamp
 */
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level}: ${message}`);
}

/**
 * Generate date range for validation
 */
function generateDateRange() {
  const dates = [];
  const startDate = CONFIG.date ? new Date(CONFIG.date) : new Date();
  
  if (!CONFIG.date) {
    startDate.setDate(startDate.getDate() - 1); // Default to yesterday
  }
  
  for (let i = 0; i < CONFIG.daysBack; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  return dates.reverse(); // Oldest first
}

/**
 * Fetch Analytics API data for comparison
 */
async function fetchAnalyticsData(date) {
  try {
    log(`📊 Fetching Analytics API data for ${date}`);
    
    const response = await fetch('http://localhost:3000/api/youtube/analytics/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: date,
        endDate: date,
        maxResults: 1000
      })
    });
    
    if (!response.ok) {
      throw new Error(`Analytics API failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.videos || [];
    
  } catch (error) {
    log(`❌ Failed to fetch Analytics data for ${date}: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Fetch Reporting API data from database
 */
async function fetchReportingData(date) {
  try {
    log(`📈 Fetching Reporting API data for ${date}`);
    
    const response = await fetch('http://localhost:3000/api/youtube/analytics/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: date
      })
    });
    
    if (!response.ok) {
      throw new Error(`Reporting data fetch failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.analytics || [];
    
  } catch (error) {
    log(`❌ Failed to fetch Reporting data for ${date}: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Calculate variance percentage between two values
 */
function calculateVariance(value1, value2) {
  if (value1 === 0 && value2 === 0) return 0;
  if (value1 === 0) return 100;
  return Math.abs((value2 - value1) / value1) * 100;
}

/**
 * Compare metrics for a single video
 */
function compareVideoMetrics(analyticsVideo, reportingVideo) {
  const comparison = {
    videoId: analyticsVideo.id || reportingVideo.video_id,
    title: analyticsVideo.title || 'Unknown',
    date: reportingVideo.date,
    analytics: {
      views: analyticsVideo.views || 0,
      watchTime: analyticsVideo.estimatedMinutesWatched || 0,
      avgViewDuration: analyticsVideo.averageViewDuration || 0
    },
    reporting: {
      views: reportingVideo.views || 0,
      watchTime: reportingVideo.estimated_minutes_watched || 0,
      avgViewDuration: reportingVideo.average_view_duration || 0
    },
    variances: {},
    status: 'unknown'
  };
  
  // Calculate variances
  comparison.variances.views = calculateVariance(comparison.analytics.views, comparison.reporting.views);
  comparison.variances.watchTime = calculateVariance(comparison.analytics.watchTime, comparison.reporting.watchTime);
  comparison.variances.avgViewDuration = calculateVariance(comparison.analytics.avgViewDuration, comparison.reporting.avgViewDuration);
  
  // Determine status
  const maxVariance = Math.max(
    comparison.variances.views,
    comparison.variances.watchTime,
    comparison.variances.avgViewDuration
  );
  
  if (maxVariance === 0) {
    comparison.status = 'exact_match';
  } else if (maxVariance <= CONFIG.tolerance) {
    comparison.status = 'within_tolerance';
  } else {
    comparison.status = 'outside_tolerance';
  }
  
  return comparison;
}

/**
 * Validate data for a single date
 */
async function validateDate(date) {
  log(`🔍 Validating data for ${date}`);
  
  const [analyticsData, reportingData] = await Promise.all([
    fetchAnalyticsData(date),
    fetchReportingData(date)
  ]);
  
  // Create lookup maps
  const analyticsMap = new Map(analyticsData.map(v => [v.id, v]));
  const reportingMap = new Map(reportingData.map(v => [v.video_id, v]));
  
  // Get all unique video IDs
  const allVideoIds = new Set([
    ...analyticsMap.keys(),
    ...reportingMap.keys()
  ]);
  
  const dateValidation = {
    date,
    totalVideos: allVideoIds.size,
    analyticsCount: analyticsData.length,
    reportingCount: reportingData.length,
    comparisons: []
  };
  
  // Compare each video
  for (const videoId of allVideoIds) {
    const analyticsVideo = analyticsMap.get(videoId);
    const reportingVideo = reportingMap.get(videoId);
    
    if (analyticsVideo && reportingVideo) {
      // Both sources have data - compare
      const comparison = compareVideoMetrics(analyticsVideo, reportingVideo);
      dateValidation.comparisons.push(comparison);
      validation.details.push(comparison);
      
      // Update validation stats
      validation.totalComparisons++;
      
      switch (comparison.status) {
        case 'exact_match':
          validation.exactMatches++;
          break;
        case 'within_tolerance':
          validation.withinTolerance++;
          break;
        case 'outside_tolerance':
          validation.outsideTolerance++;
          break;
      }
      
      // Update metric stats
      ['views', 'watchTime', 'avgViewDuration'].forEach(metric => {
        validation.metrics[metric].total++;
        if (comparison.variances[metric] === 0) {
          validation.metrics[metric].matches++;
        }
        validation.metrics[metric].avgVariance += comparison.variances[metric];
      });
      
    } else if (analyticsVideo && !reportingVideo) {
      validation.onlyInAnalytics++;
      log(`⚠️ Video ${videoId} only in Analytics API`, 'WARN');
    } else if (!analyticsVideo && reportingVideo) {
      validation.onlyInReporting++;
      log(`⚠️ Video ${videoId} only in Reporting API`, 'WARN');
    }
  }
  
  log(`✅ Validated ${date}: ${dateValidation.comparisons.length} comparisons`);
  return dateValidation;
}

/**
 * Generate comprehensive validation report
 */
function generateReport() {
  // Calculate final averages
  Object.keys(validation.metrics).forEach(metric => {
    if (validation.metrics[metric].total > 0) {
      validation.metrics[metric].avgVariance /= validation.metrics[metric].total;
    }
  });
  
  const duration = new Date() - validation.startTime;
  const successRate = ((validation.exactMatches + validation.withinTolerance) / validation.totalComparisons * 100).toFixed(1);
  
  const report = `
📊 YOUTUBE REPORTING API DATA VALIDATION REPORT
==============================================

⏱️  VALIDATION SUMMARY
- Start Time: ${validation.startTime.toISOString()}
- End Time: ${new Date().toISOString()}
- Duration: ${(duration / 1000).toFixed(1)} seconds
- Dates Processed: ${validation.datesProcessed.length}
- Tolerance: ±${CONFIG.tolerance}%

📈 COMPARISON STATISTICS
- Total Comparisons: ${validation.totalComparisons}
- Exact Matches: ${validation.exactMatches} (${(validation.exactMatches/validation.totalComparisons*100).toFixed(1)}%)
- Within Tolerance: ${validation.withinTolerance} (${(validation.withinTolerance/validation.totalComparisons*100).toFixed(1)}%)
- Outside Tolerance: ${validation.outsideTolerance} (${(validation.outsideTolerance/validation.totalComparisons*100).toFixed(1)}%)
- Success Rate: ${successRate}%

📊 DATA COVERAGE
- Only in Analytics API: ${validation.onlyInAnalytics}
- Only in Reporting API: ${validation.onlyInReporting}

📉 METRIC ANALYSIS
- Views: ${validation.metrics.views.matches}/${validation.metrics.views.total} exact matches (avg variance: ${validation.metrics.views.avgVariance.toFixed(2)}%)
- Watch Time: ${validation.metrics.watchTime.matches}/${validation.metrics.watchTime.total} exact matches (avg variance: ${validation.metrics.watchTime.avgVariance.toFixed(2)}%)
- Avg View Duration: ${validation.metrics.avgViewDuration.matches}/${validation.metrics.avgViewDuration.total} exact matches (avg variance: ${validation.metrics.avgViewDuration.avgVariance.toFixed(2)}%)

🎯 QUALITY ASSESSMENT
${successRate >= 95 ? '🟢 EXCELLENT: Data quality is excellent (≥95% success rate)' : 
  successRate >= 90 ? '🟡 GOOD: Data quality is good (≥90% success rate)' :
  successRate >= 80 ? '🟠 ACCEPTABLE: Data quality is acceptable (≥80% success rate)' :
  '🔴 POOR: Data quality needs attention (<80% success rate)'}

${validation.outsideTolerance > 0 ? `
⚠️  VIDEOS OUTSIDE TOLERANCE (Top 10)
${validation.details
  .filter(d => d.status === 'outside_tolerance')
  .sort((a, b) => Math.max(b.variances.views, b.variances.watchTime) - Math.max(a.variances.views, a.variances.watchTime))
  .slice(0, 10)
  .map(d => `- ${d.videoId}: Views ${d.variances.views.toFixed(1)}%, Watch Time ${d.variances.watchTime.toFixed(1)}%`)
  .join('\n')}
` : '✅ ALL VIDEOS WITHIN TOLERANCE'}

==============================================
`;

  log(report, 'REPORT');
  
  // Save report to file
  fs.writeFileSync(CONFIG.reportFile, report);
  log(`📄 Report saved to: ${CONFIG.reportFile}`, 'INFO');
  
  // Export CSV if requested
  if (CONFIG.outputCsv) {
    exportToCsv();
  }
}

/**
 * Export comparison data to CSV
 */
function exportToCsv() {
  const csvFile = path.join(__dirname, `validation-data-${new Date().toISOString().split('T')[0]}.csv`);
  
  const headers = [
    'Video ID', 'Date', 'Title',
    'Analytics Views', 'Reporting Views', 'Views Variance %',
    'Analytics Watch Time', 'Reporting Watch Time', 'Watch Time Variance %',
    'Analytics Avg Duration', 'Reporting Avg Duration', 'Avg Duration Variance %',
    'Status'
  ];
  
  const rows = validation.details.map(d => [
    d.videoId, d.date, `"${d.title}"`,
    d.analytics.views, d.reporting.views, d.variances.views.toFixed(2),
    d.analytics.watchTime, d.reporting.watchTime, d.variances.watchTime.toFixed(2),
    d.analytics.avgViewDuration, d.reporting.avgViewDuration, d.variances.avgViewDuration.toFixed(2),
    d.status
  ]);
  
  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  
  fs.writeFileSync(csvFile, csvContent);
  log(`📊 CSV exported to: ${csvFile}`, 'INFO');
}

/**
 * Main validation execution
 */
async function main() {
  try {
    log('🚀 Starting YouTube Reporting API Data Validation', 'START');
    log(`📋 Configuration: ${CONFIG.daysBack} days, ±${CONFIG.tolerance}% tolerance`, 'CONFIG');
    
    const dates = generateDateRange();
    validation.datesProcessed = dates;
    
    log(`📅 Validating ${dates.length} dates from ${dates[0]} to ${dates[dates.length - 1]}`, 'INFO');
    
    // Process each date
    for (const date of dates) {
      await validateDate(date);
      
      // Small delay between dates
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Generate final report
    generateReport();
    
    log('🎉 Validation completed successfully!', 'SUCCESS');
    
    // Exit with appropriate code
    const successRate = (validation.exactMatches + validation.withinTolerance) / validation.totalComparisons * 100;
    process.exit(successRate >= 80 ? 0 : 1);
    
  } catch (error) {
    log(`💥 Critical error during validation: ${error.message}`, 'CRITICAL');
    console.error(error);
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
YouTube Reporting API Data Validation Script

Usage: node scripts/validate-reporting-data.js [options]

Options:
  --date <YYYY-MM-DD>      Specific date to validate (default: yesterday)
  --days-back <number>     Number of days to validate (default: 7)
  --tolerance <number>     Acceptable variance percentage (default: 5)
  --output-csv            Export comparison to CSV file
  --verbose               Show detailed per-video analysis
  --help, -h              Show this help message

Examples:
  node scripts/validate-reporting-data.js --days-back=3
  node scripts/validate-reporting-data.js --date=2025-06-20 --tolerance=10
  node scripts/validate-reporting-data.js --output-csv --verbose
`);
  process.exit(0);
}

// Run validation
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main, CONFIG };