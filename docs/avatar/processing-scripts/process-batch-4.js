import fs from 'fs';

// Load batch 4
const batchData = JSON.parse(fs.readFileSync('docs/comment-batches/batch-04.json', 'utf8'));

console.log(`Batch 4 contains ${batchData.length} comments`);

// Extract essential fields to reduce size
const extractedData = batchData.map(comment => ({
  text: comment.comment_text,
  likes: comment.like_count,
  video: comment.video_title,
  video_id: comment.video_id,
  channel: comment.channel_name
}));

// Calculate sizes
const fullSize = JSON.stringify(batchData).length;
const extractedSize = JSON.stringify(extractedData).length;

console.log(`Full data size: ${(fullSize / 1024).toFixed(1)}KB`);
console.log(`Extracted data size: ${(extractedSize / 1024).toFixed(1)}KB`);

// Split into two halves
const midpoint = Math.floor(extractedData.length / 2);
const part1 = extractedData.slice(0, midpoint);
const part2 = extractedData.slice(midpoint);

// Create directory if it doesn't exist
if (!fs.existsSync('docs/comment-batches-split')) {
  fs.mkdirSync('docs/comment-batches-split', { recursive: true });
}

// Save the two parts
fs.writeFileSync(
  'docs/comment-batches-split/batch-04-part1.json',
  JSON.stringify(part1, null, 2)
);

fs.writeFileSync(
  'docs/comment-batches-split/batch-04-part2.json',
  JSON.stringify(part2, null, 2)
);

const part1Size = JSON.stringify(part1).length;
const part2Size = JSON.stringify(part2).length;

console.log(`\nSplit into two files:`);
console.log(`Part 1: ${part1.length} comments, ${(part1Size / 1024).toFixed(1)}KB`);
console.log(`Part 2: ${part2.length} comments, ${(part2Size / 1024).toFixed(1)}KB`);

// Show video distribution
const videoDistribution = {};
extractedData.forEach(comment => {
  if (!videoDistribution[comment.video]) {
    videoDistribution[comment.video] = 0;
  }
  videoDistribution[comment.video]++;
});

console.log('\nTop videos in this batch:');
Object.entries(videoDistribution)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([video, count]) => {
    console.log(`  ${count} comments: ${video.substring(0, 45)}...`);
  });