import fs from 'fs';

// Read the full dataset
const allComments = JSON.parse(fs.readFileSync('docs/customer-avatar-all-comments.json', 'utf8'));

// Extract batch 14 (comments 3251-3500)
const batchStart = 3250;
const batchEnd = 3500;
const batchComments = allComments.slice(batchStart, batchEnd);

// Split into two parts for token limits
const midPoint = Math.floor(batchComments.length / 2);
const part1 = batchComments.slice(0, midPoint);
const part2 = batchComments.slice(midPoint);

// Save both parts
fs.writeFileSync('batch-14-part1.json', JSON.stringify(part1, null, 2));
fs.writeFileSync('batch-14-part2.json', JSON.stringify(part2, null, 2));

console.log(`Batch 14 created:`);
console.log(`- Part 1: ${part1.length} comments`);
console.log(`- Part 2: ${part2.length} comments`);
console.log(`- Total: ${batchComments.length} comments`);
console.log(`- Date range: ${batchComments[0].published_at} to ${batchComments[batchComments.length-1].published_at}`);