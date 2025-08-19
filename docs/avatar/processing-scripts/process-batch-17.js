import fs from 'fs';

// Read the complete comments file
const allComments = JSON.parse(fs.readFileSync('docs/customer-avatar-all-comments.json', 'utf8'));

// Extract batch 17 (comments 4001-4250)
const batchStart = 4000;
const batchEnd = 4250;
const batchComments = allComments.slice(batchStart, batchEnd);

// Split into two parts for token limits
const midPoint = Math.floor(batchComments.length / 2);
const part1 = batchComments.slice(0, midPoint);
const part2 = batchComments.slice(midPoint);

// Save both parts
fs.writeFileSync('batch-17-part1.json', JSON.stringify(part1, null, 2));
fs.writeFileSync('batch-17-part2.json', JSON.stringify(part2, null, 2));

console.log(`Batch 17 extracted:`);
console.log(`- Part 1: ${part1.length} comments (${batchStart + 1}-${batchStart + midPoint})`);
console.log(`- Part 2: ${part2.length} comments (${batchStart + midPoint + 1}-${batchEnd})`);
console.log(`- Date range: ${batchComments[0]?.published_at} to ${batchComments[batchComments.length-1]?.published_at}`);