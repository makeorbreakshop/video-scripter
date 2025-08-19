import fs from 'fs';
import path from 'path';

// Function to analyze a single batch and create analysis document
function analyzeBatch(batchNum) {
  const inputFile = path.join('docs/comment-batches-text', `batch-${String(batchNum).padStart(2, '0')}-text.json`);
  const outputFile = path.join('docs/comment-analysis', `batch-${String(batchNum).padStart(2, '0')}-analysis.md`);
  
  const batchData = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  
  // Split batch into two halves for reading
  const midpoint = Math.floor(batchData.length / 2);
  const firstHalf = batchData.slice(0, midpoint);
  const secondHalf = batchData.slice(midpoint);
  
  // Save halves temporarily
  const tempDir = 'docs/comment-batches-split';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const firstHalfFile = path.join(tempDir, `batch-${String(batchNum).padStart(2, '0')}-part1.json`);
  const secondHalfFile = path.join(tempDir, `batch-${String(batchNum).padStart(2, '0')}-part2.json`);
  
  fs.writeFileSync(firstHalfFile, JSON.stringify(firstHalf, null, 2));
  fs.writeFileSync(secondHalfFile, JSON.stringify(secondHalf, null, 2));
  
  const stats1 = fs.statSync(firstHalfFile);
  const stats2 = fs.statSync(secondHalfFile);
  
  console.log(`Batch ${batchNum} split:`);
  console.log(`  Part 1: ${firstHalf.length} comments - ${(stats1.size / 1024).toFixed(1)}KB`);
  console.log(`  Part 2: ${secondHalf.length} comments - ${(stats2.size / 1024).toFixed(1)}KB`);
}

// Create analysis directory
if (!fs.existsSync('docs/comment-analysis')) {
  fs.mkdirSync('docs/comment-analysis', { recursive: true });
}

// Process batch 1 for now
analyzeBatch(1);

console.log('\nReady for analysis!');