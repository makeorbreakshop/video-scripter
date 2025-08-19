import fs from 'fs';
import path from 'path';

// Process each batch to extract just comment text and minimal metadata
const batchDir = 'docs/comment-batches';
const outputDir = 'docs/comment-batches-text';

// Create output directory
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Process all batch files
for (let i = 1; i <= 30; i++) {
  const batchNum = String(i).padStart(2, '0');
  const inputFile = path.join(batchDir, `batch-${batchNum}.json`);
  const outputFile = path.join(outputDir, `batch-${batchNum}-text.json`);
  
  const batchData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  
  // Extract only essential fields to reduce size
  const extractedData = batchData.map(comment => ({
    text: comment.comment_text,
    likes: comment.like_count,
    video: comment.video_title.substring(0, 50) // Truncate long titles
  }));
  
  fs.writeFileSync(outputFile, JSON.stringify(extractedData, null, 2));
  
  const stats = fs.statSync(outputFile);
  const fileSizeKB = (stats.size / 1024).toFixed(1);
  console.log(`Batch ${i}: ${extractedData.length} comments - ${fileSizeKB}KB`);
}

console.log('\nText-only batches created in:', outputDir);