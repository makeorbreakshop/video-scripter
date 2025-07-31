// Estimate IOPS usage for LLM summary vectorization

console.log('📊 IOPS Usage Estimation for LLM Summary Vectorization\n');

// Current configuration
const BATCH_SIZE = 50; // Videos fetched per batch
const EMBEDDING_BATCH_SIZE = 25; // Videos processed at once
const BATCH_DELAY_MS = 5000; // Delay between main batches

// Calculate IOPS per batch
console.log('Per batch cycle:');
console.log(`1. Fetch ${BATCH_SIZE} videos: 1 read operation`);
console.log(`2. Process ${BATCH_SIZE / EMBEDDING_BATCH_SIZE} embedding batches`);
console.log(`3. Update ${EMBEDDING_BATCH_SIZE} videos per sub-batch: ${BATCH_SIZE / EMBEDDING_BATCH_SIZE} write operations`);
console.log(`4. Update job progress: 1 write operation`);

const totalIOPSPerBatch = 1 + (BATCH_SIZE / EMBEDDING_BATCH_SIZE) + 1;
console.log(`\nTotal IOPS per batch: ${totalIOPSPerBatch}`);

// Calculate rate
const batchesPerMinute = 60000 / BATCH_DELAY_MS;
const iopsPerMinute = totalIOPSPerBatch * batchesPerMinute;

console.log(`\n⏱️  Timing:`);
console.log(`- Batches per minute: ${batchesPerMinute}`);
console.log(`- IOPS per minute: ${iopsPerMinute}`);
console.log(`- IOPS per second: ${(iopsPerMinute / 60).toFixed(1)}`);

console.log(`\n✅ With 500 IOPS limit:`);
console.log(`- Current usage: ${(iopsPerMinute / 60).toFixed(1)} IOPS/sec (${((iopsPerMinute / 60) / 500 * 100).toFixed(1)}% of limit)`);
console.log(`- Safety margin: ${(500 - (iopsPerMinute / 60)).toFixed(1)} IOPS/sec available`);

// Calculate processing speed
const videosPerHour = BATCH_SIZE * batchesPerMinute * 60;
const totalVideos = 181459; // From your earlier check
const estimatedHours = totalVideos / videosPerHour;

console.log(`\n📈 Processing Speed:`);
console.log(`- Videos per hour: ${videosPerHour.toLocaleString()}`);
console.log(`- Total videos: ${totalVideos.toLocaleString()}`);
console.log(`- Estimated time: ${estimatedHours.toFixed(1)} hours (${(estimatedHours / 24).toFixed(1)} days)`);

console.log(`\n💡 Recommendations:`);
console.log(`- Monitor https://supabase.com/dashboard/project/mhzwrynnfphlxqcqytrj/reports/database`);
console.log(`- Watch for IOPS spikes during processing`);
console.log(`- Consider upgrading to Small plan (1,000 IOPS) for 2x speed`);