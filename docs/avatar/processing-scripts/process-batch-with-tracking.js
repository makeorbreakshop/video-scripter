import fs from 'fs';
import path from 'path';

function processBatch(batchNum) {
  // Load or initialize cumulative tracking
  let cumulative;
  const cumulativeFile = 'docs/comment-analysis/cumulative-insights.json';
  
  if (fs.existsSync(cumulativeFile)) {
    cumulative = JSON.parse(fs.readFileSync(cumulativeFile, 'utf8'));
  } else {
    cumulative = {
      totalCommentsAnalyzed: 0,
      batchesCompleted: [],
      videoCommentCounts: {},
      
      // Pattern frequency tracking
      goalPhrases: {},
      painPoints: {},
      questionTypes: {},
      identityMarkers: {},
      technicalTerms: {},
      emotionalLanguage: {},
      
      // Video-specific patterns
      videoPatterns: {},
      
      // Emerging themes
      emergingThemes: [],
      
      // Unique insights per batch
      batchInsights: {}
    };
  }
  
  // Load batch data
  const batchPadded = String(batchNum).padStart(2, '0');
  const batchFile = `docs/comment-batches/batch-${batchPadded}.json`;
  const batchData = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  
  // Update cumulative counts
  cumulative.totalCommentsAnalyzed += batchData.length;
  cumulative.batchesCompleted.push(batchNum);
  
  // Track video distribution
  batchData.forEach(comment => {
    const video = comment.video_title;
    if (!cumulative.videoCommentCounts[video]) {
      cumulative.videoCommentCounts[video] = 0;
    }
    cumulative.videoCommentCounts[video]++;
    
    // Track patterns per video
    if (!cumulative.videoPatterns[video]) {
      cumulative.videoPatterns[video] = {
        questionCount: 0,
        painCount: 0,
        successCount: 0,
        technicalCount: 0
      };
    }
    
    // Simple pattern detection (would be more sophisticated in real analysis)
    const text = comment.comment_text.toLowerCase();
    if (text.includes('?')) cumulative.videoPatterns[video].questionCount++;
    if (text.includes("can't") || text.includes("confused") || text.includes("stuck")) {
      cumulative.videoPatterns[video].painCount++;
    }
    if (text.includes("works") || text.includes("success") || text.includes("great")) {
      cumulative.videoPatterns[video].successCount++;
    }
  });
  
  // Save batch-specific insights (placeholder for manual additions)
  cumulative.batchInsights[`batch_${batchNum}`] = {
    processedAt: new Date().toISOString(),
    commentCount: batchData.length,
    topVideos: Object.entries(cumulative.videoCommentCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([video, count]) => ({ video: video.substring(0, 50), count }))
  };
  
  // Save cumulative tracking
  fs.writeFileSync(cumulativeFile, JSON.stringify(cumulative, null, 2));
  
  // Create batch summary
  const summaryFile = `docs/comment-analysis/batch-${batchPadded}-summary.json`;
  const batchSummary = {
    batchNumber: batchNum,
    totalComments: batchData.length,
    videoDistribution: {},
    processedAt: new Date().toISOString()
  };
  
  // Calculate video distribution for this batch
  batchData.forEach(comment => {
    const video = comment.video_title;
    if (!batchSummary.videoDistribution[video]) {
      batchSummary.videoDistribution[video] = 0;
    }
    batchSummary.videoDistribution[video]++;
  });
  
  fs.writeFileSync(summaryFile, JSON.stringify(batchSummary, null, 2));
  
  console.log(`\n=== Batch ${batchNum} Processed ===`);
  console.log(`Comments in batch: ${batchData.length}`);
  console.log(`Total comments analyzed: ${cumulative.totalCommentsAnalyzed}`);
  console.log(`Batches completed: ${cumulative.batchesCompleted.join(', ')}`);
  
  // Show top videos overall
  console.log('\nTop 5 Videos Overall:');
  Object.entries(cumulative.videoCommentCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([video, count]) => {
      console.log(`  ${count} comments: ${video.substring(0, 45)}...`);
    });
}

// Get batch number from command line argument
const batchNum = parseInt(process.argv[2]) || 1;
processBatch(batchNum);

console.log('\n✅ Batch processed successfully!');
console.log('Files updated:');
console.log('  - cumulative-insights.json (builds with each batch)');
console.log('  - batch-XX-summary.json (per-batch summaries)');
console.log(`\nRun "node process-batch-with-tracking.js ${batchNum + 1}" to continue with next batch.`);