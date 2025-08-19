import fs from 'fs';

// Read batch 5
const batch5 = JSON.parse(fs.readFileSync('docs/comment-batches/batch-05.json', 'utf8'));

console.log(`Batch 5 contains ${batch5.length} comments`);

// Check date range
const dates = batch5.map(c => c.published_at);
const earliest = dates.sort()[0];
const latest = dates.sort()[dates.length - 1];
console.log(`Date range: ${earliest} to ${latest}`);

// Extract key fields for analysis
const extractedData = batch5.map(comment => ({
  text: comment.comment_text,
  likes: comment.like_count,
  video: comment.video_title,
  video_id: comment.video_id,
  channel: comment.channel_name,
  date: comment.published_at
}));

// Split into two halves for token limits
const midpoint = Math.floor(extractedData.length / 2);
const firstHalf = extractedData.slice(0, midpoint);
const secondHalf = extractedData.slice(midpoint);

// Save the splits
fs.writeFileSync('batch-05-part1.json', JSON.stringify(firstHalf, null, 2));
fs.writeFileSync('batch-05-part2.json', JSON.stringify(secondHalf, null, 2));

// File size check
const part1Size = fs.statSync('batch-05-part1.json').size / 1024;
const part2Size = fs.statSync('batch-05-part2.json').size / 1024;

console.log(`Part 1: ${firstHalf.length} comments, ${part1Size.toFixed(1)}KB`);
console.log(`Part 2: ${secondHalf.length} comments, ${part2Size.toFixed(1)}KB`);

// Quick preview of patterns
const businessTerms = ['business', 'sell', 'etsy', 'customer', 'money', 'profit'];
const painTerms = ['problem', 'issue', 'broken', 'confused', "can't", "won't"];
const yearMatch = earliest.substring(0, 4);

const businessCount = batch5.filter(c => 
  businessTerms.some(term => c.comment_text.toLowerCase().includes(term))
).length;

const painCount = batch5.filter(c => 
  painTerms.some(term => c.comment_text.toLowerCase().includes(term))
).length;

console.log(`\nQuick patterns:`);
console.log(`- Year: ${yearMatch}`);
console.log(`- Business intent: ${businessCount} comments (${(businessCount/batch5.length*100).toFixed(1)}%)`);
console.log(`- Pain/problems: ${painCount} comments (${(painCount/batch5.length*100).toFixed(1)}%)`);