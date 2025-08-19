import fs from 'fs';
import path from 'path';

// Load batch 2 data
const batchFile = 'docs/comment-batches/batch-02.json';
const batchData = JSON.parse(fs.readFileSync(batchFile, 'utf8'));

console.log(`\nBatch 2: ${batchData.length} comments`);

// Extract essential fields for readability
const extractedData = batchData.map(comment => ({
  text: comment.comment_text,
  likes: comment.like_count,
  video: comment.video_title,
  video_id: comment.video_id,
  channel: comment.channel_name
}));

// Split into two halves for reading
const midpoint = Math.floor(extractedData.length / 2);
const firstHalf = extractedData.slice(0, midpoint);
const secondHalf = extractedData.slice(midpoint);

// Create output directory
const outputDir = 'docs/comment-batches-split';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Save both halves
const firstHalfFile = path.join(outputDir, 'batch-02-part1.json');
const secondHalfFile = path.join(outputDir, 'batch-02-part2.json');

fs.writeFileSync(firstHalfFile, JSON.stringify(firstHalf, null, 2));
fs.writeFileSync(secondHalfFile, JSON.stringify(secondHalf, null, 2));

// Check file sizes
const stats1 = fs.statSync(firstHalfFile);
const stats2 = fs.statSync(secondHalfFile);

console.log(`\nBatch 2 split:`);
console.log(`  Part 1: ${firstHalf.length} comments - ${(stats1.size / 1024).toFixed(1)}KB`);
console.log(`  Part 2: ${secondHalf.length} comments - ${(stats2.size / 1024).toFixed(1)}KB`);

// Get video distribution for this batch
const videoCount = {};
batchData.forEach(comment => {
  const video = comment.video_title;
  if (!videoCount[video]) {
    videoCount[video] = 0;
  }
  videoCount[video]++;
});

console.log('\nTop videos in Batch 2:');
Object.entries(videoCount)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([video, count]) => {
    console.log(`  ${count} comments: ${video.substring(0, 45)}...`);
  });