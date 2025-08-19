import fs from 'fs';

// Read batch 8
const batch8 = JSON.parse(fs.readFileSync('docs/comment-batches/batch-08.json', 'utf8'));

console.log(`Batch 8 contains ${batch8.length} comments`);

// Check date range
const dates = batch8.map(c => c.published_at);
const earliest = dates.sort()[0];
const latest = dates.sort()[dates.length - 1];
console.log(`Date range: ${earliest} to ${latest}`);

// Extract key fields for analysis
const extractedData = batch8.map(comment => ({
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
fs.writeFileSync('batch-08-part1.json', JSON.stringify(firstHalf, null, 2));
fs.writeFileSync('batch-08-part2.json', JSON.stringify(secondHalf, null, 2));

// File size check
const part1Size = fs.statSync('batch-08-part1.json').size / 1024;
const part2Size = fs.statSync('batch-08-part2.json').size / 1024;

console.log(`Part 1: ${firstHalf.length} comments, ${part1Size.toFixed(1)}KB`);
console.log(`Part 2: ${secondHalf.length} comments, ${part2Size.toFixed(1)}KB`);

// Quick preview of patterns
const businessTerms = ['business', 'sell', 'etsy', 'customer', 'money', 'profit', 'side hustle', 'small business'];
const painTerms = ['problem', 'issue', 'broken', 'confused', "can't", "won't", 'frustrated', 'waste'];
const yearMatch = earliest.substring(0, 4);

const businessCount = batch8.filter(c => 
  businessTerms.some(term => c.comment_text.toLowerCase().includes(term))
).length;

const painCount = batch8.filter(c => 
  painTerms.some(term => c.comment_text.toLowerCase().includes(term))
).length;

// Track evolving mentions
const mentions = {
  lightburn: 0,
  proprietary: 0,
  cloud: 0,
  subscription: 0,
  glowforge: 0,
  china: 0,
  safety: 0,
  fire: 0,
  air_assist: 0
};

batch8.forEach(c => {
  const lower = c.comment_text.toLowerCase();
  if (lower.includes('lightburn')) mentions.lightburn++;
  if (lower.includes('proprietary')) mentions.proprietary++;
  if (lower.includes('cloud')) mentions.cloud++;
  if (lower.includes('subscription')) mentions.subscription++;
  if (lower.includes('glowforge')) mentions.glowforge++;
  if (lower.includes('china') || lower.includes('chinese')) mentions.china++;
  if (lower.includes('safety') || lower.includes('safe')) mentions.safety++;
  if (lower.includes('fire')) mentions.fire++;
  if (lower.includes('air assist')) mentions.air_assist++;
});

console.log(`\nQuick patterns:`);
console.log(`- Year: ${yearMatch}`);
console.log(`- Business intent: ${businessCount} comments (${(businessCount/batch8.length*100).toFixed(1)}%)`);
console.log(`- Pain/problems: ${painCount} comments (${(painCount/batch8.length*100).toFixed(1)}%)`);
console.log(`- Key mentions:`, mentions);