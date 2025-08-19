import fs from 'fs';

// Initialize cumulative tracking document
const cumulativeTracking = {
  videoCommentCounts: {},
  videoTopicMapping: {},
  patternFrequency: {
    goals: {},
    pains: {},
    questions: {},
    identityMarkers: {},
    technicalTerms: {}
  },
  emergingThemes: [],
  batchProgress: {
    analyzed: 1,
    totalBatches: 30
  }
};

// Process Batch 1 data to start tracking
const batch1Data = JSON.parse(fs.readFileSync('docs/comment-batches/batch-01.json', 'utf8'));

// Count comments per video
batch1Data.forEach(comment => {
  const videoTitle = comment.video_title;
  if (!cumulativeTracking.videoCommentCounts[videoTitle]) {
    cumulativeTracking.videoCommentCounts[videoTitle] = 0;
  }
  cumulativeTracking.videoCommentCounts[videoTitle]++;
});

// Sort videos by comment count
const sortedVideos = Object.entries(cumulativeTracking.videoCommentCounts)
  .sort((a, b) => b[1] - a[1]);

console.log('\n=== VIDEO COMMENT DISTRIBUTION (Batch 1) ===');
sortedVideos.slice(0, 10).forEach(([video, count]) => {
  console.log(`${count} comments: ${video.substring(0, 50)}...`);
});

// Save cumulative tracking
fs.writeFileSync(
  'docs/comment-analysis/cumulative-tracking.json',
  JSON.stringify(cumulativeTracking, null, 2)
);

console.log('\nCumulative tracking initialized.');
console.log('Ready to process Batch 2 with video context awareness.');