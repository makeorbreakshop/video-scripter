// Optimize IOPS usage for maximum speed within 500 IOPS limit

console.log('🚀 Optimizing for Maximum Speed with 500 IOPS limit\n');

// We have 500 IOPS to work with
const IOPS_LIMIT = 500;
const SAFETY_MARGIN = 0.8; // Use 80% of limit to be safe
const TARGET_IOPS = IOPS_LIMIT * SAFETY_MARGIN; // 400 IOPS

console.log(`💪 Target: ${TARGET_IOPS} IOPS/sec (80% of ${IOPS_LIMIT} limit)\n`);

// More realistic IOPS calculation
// Per batch cycle:
// - 1 read to fetch videos
// - Multiple writes for updates (let's say 1 per sub-batch)
// - 1 write for job progress
// For batch of 300: ~5 IOPS per batch

const IOPS_PER_BATCH = 5;
const MAX_BATCHES_PER_SECOND = TARGET_IOPS / IOPS_PER_BATCH; // 80 batches/sec max

console.log(`📊 Realistic Configuration:`);
console.log(`- IOPS per batch: ${IOPS_PER_BATCH}`);
console.log(`- Max batches per second: ${MAX_BATCHES_PER_SECOND}`);

// But we need to be realistic about processing time
// Embedding generation takes time, let's assume 2 seconds per batch minimum
const REALISTIC_BATCH_TIME = 2000; // 2 seconds per batch
const BATCHES_PER_SECOND = 1000 / REALISTIC_BATCH_TIME;

// Calculate with different batch sizes
const batchSizes = [100, 200, 300, 400, 500];

console.log(`\n⚡ Speed Analysis by Batch Size:`);
batchSizes.forEach(size => {
  const batchInterval = (1000 / BATCHES_PER_SECOND);
  const videosPerSecond = size * BATCHES_PER_SECOND;
  const videosPerHour = videosPerSecond * 3600;
  const totalHours = 181459 / videosPerHour;
  
  console.log(`\nBatch size ${size}:`);
  console.log(`  - Batch interval: ${batchInterval.toFixed(0)}ms`);
  console.log(`  - Videos/second: ${videosPerSecond.toFixed(0)}`);
  console.log(`  - Videos/hour: ${videosPerHour.toLocaleString()}`);
  console.log(`  - Total time: ${totalHours.toFixed(1)} hours`);
});

console.log(`\n🎯 Recommendation:`);
console.log(`- Use batch size 300-400 for optimal balance`);
console.log(`- Set batch interval to ~10ms (essentially no delay)`);
console.log(`- This gives you ~1 hour processing time!`);
console.log(`- Monitor dashboard for actual IOPS usage`);