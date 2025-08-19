import fs from 'fs';

// Read batch 9
const batch9 = JSON.parse(fs.readFileSync('docs/comment-batches/batch-09.json', 'utf8'));

console.log(`Batch 9 contains ${batch9.length} comments`);

// Check date range
const dates = batch9.map(c => c.published_at);
const earliest = dates.sort()[0];
const latest = dates.sort()[dates.length - 1];
console.log(`Date range: ${earliest} to ${latest}`);

// Extract key fields for analysis
const extractedData = batch9.map(comment => ({
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
fs.writeFileSync('batch-09-part1.json', JSON.stringify(firstHalf, null, 2));
fs.writeFileSync('batch-09-part2.json', JSON.stringify(secondHalf, null, 2));

// File size check
const part1Size = fs.statSync('batch-09-part1.json').size / 1024;
const part2Size = fs.statSync('batch-09-part2.json').size / 1024;

console.log(`Part 1: ${firstHalf.length} comments, ${part1Size.toFixed(1)}KB`);
console.log(`Part 2: ${secondHalf.length} comments, ${part2Size.toFixed(1)}KB`);

// Quick preview of patterns
const businessTerms = ['business', 'sell', 'etsy', 'customer', 'money', 'profit', 'side hustle', 'small business'];
const painTerms = ['problem', 'issue', 'broken', 'confused', "can't", "won't", 'frustrated', 'waste'];
const yearMatch = earliest.substring(0, 4);

const businessCount = batch9.filter(c => 
  businessTerms.some(term => c.comment_text.toLowerCase().includes(term))
).length;

const painCount = batch9.filter(c => 
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
  air_assist: 0,
  enclosure: 0
};

batch9.forEach(c => {
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
  if (lower.includes('enclosure') || lower.includes('enclosed')) mentions.enclosure++;
});

console.log(`\nQuick patterns:`);
console.log(`- Year: ${yearMatch}`);
console.log(`- Business intent: ${businessCount} comments (${(businessCount/batch9.length*100).toFixed(1)}%)`);
console.log(`- Pain/problems: ${painCount} comments (${(painCount/batch9.length*100).toFixed(1)}%)`);
console.log(`- Key mentions:`, mentions);