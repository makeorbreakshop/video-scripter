import fs from 'fs';
import path from 'path';

// Read the JSON file (easier to work with than CSV)
const commentsData = JSON.parse(fs.readFileSync('docs/customer-avatar-all-comments.json', 'utf8'));

console.log(`Total comments: ${commentsData.length}`);

// Calculate batch size
const BATCH_SIZE = 250;
const totalBatches = Math.ceil(commentsData.length / BATCH_SIZE);

console.log(`Creating ${totalBatches} batches of ~${BATCH_SIZE} comments each`);

// Create batches directory
const batchDir = 'docs/comment-batches';
if (!fs.existsSync(batchDir)) {
  fs.mkdirSync(batchDir, { recursive: true });
}

// Split into batches
for (let i = 0; i < totalBatches; i++) {
  const start = i * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, commentsData.length);
  const batch = commentsData.slice(start, end);
  
  const batchNum = i + 1;
  const filename = path.join(batchDir, `batch-${String(batchNum).padStart(2, '0')}.json`);
  
  fs.writeFileSync(filename, JSON.stringify(batch, null, 2));
  
  // Calculate file size
  const stats = fs.statSync(filename);
  const fileSizeKB = (stats.size / 1024).toFixed(1);
  
  console.log(`Batch ${batchNum}: ${batch.length} comments (${start + 1}-${end}) - ${fileSizeKB}KB`);
}

console.log('\nBatches created successfully!');
console.log(`Files saved in: ${batchDir}/`);