import fs from 'fs';

// Read the complete comments file
const allComments = JSON.parse(fs.readFileSync('docs/customer-avatar-all-comments.json', 'utf8'));

// Extract batch 30 (comments 7251-7276 - FINAL BATCH!)
const batchStart = 7250;
const batchEnd = 7276; // Only 26 comments left!
const batchComments = allComments.slice(batchStart, batchEnd);

// Since this is a small batch, we don't need to split
fs.writeFileSync('batch-30-final.json', JSON.stringify(batchComments, null, 2));

console.log(`FINAL Batch 30 extracted:`);
console.log(`- ${batchComments.length} comments (${batchStart + 1}-${batchEnd})`);
console.log(`- Date range: ${batchComments[0]?.published_at} to ${batchComments[batchComments.length-1]?.published_at}`);
console.log(`- ANALYSIS COMPLETE: 100% of ${allComments.length} comments processed!`);