#!/usr/bin/env node

async function testRandomness() {
  console.log("🎲 Testing Randomness & Duplicates");
  console.log("=" .repeat(50));
  
  const params = "timeRange=week&minScore=3&minViews=10000&randomize=true&limit=50";
  const numRequests = 5;
  const allVideos = new Set();
  const videosByRequest = [];
  
  console.log("\nFetching 5 random batches of 50 videos each...\n");
  
  for (let i = 0; i < numRequests; i++) {
    const response = await fetch(`http://localhost:3000/api/idea-radar?${params}`);
    const data = await response.json();
    
    const videoIds = data.outliers.map(v => v.video_id);
    videosByRequest.push(new Set(videoIds));
    videoIds.forEach(id => allVideos.add(id));
    
    console.log(`Batch ${i+1}: Got ${videoIds.length} videos`);
  }
  
  // Check for duplicates between batches
  console.log("\n" + "-".repeat(50));
  console.log("Duplicate Analysis:");
  
  let totalDuplicates = 0;
  for (let i = 0; i < numRequests; i++) {
    for (let j = i + 1; j < numRequests; j++) {
      const intersection = [...videosByRequest[i]].filter(id => videosByRequest[j].has(id));
      if (intersection.length > 0) {
        console.log(`❌ Batch ${i+1} ∩ Batch ${j+1}: ${intersection.length} duplicates`);
        totalDuplicates += intersection.length;
      }
    }
  }
  
  if (totalDuplicates === 0) {
    console.log("✅ No duplicates found between batches!");
  }
  
  console.log("\n" + "-".repeat(50));
  console.log("Summary:");
  console.log(`- Total unique videos seen: ${allVideos.size}`);
  console.log(`- Total videos fetched: ${numRequests * 50}`);
  console.log(`- Randomness score: ${(allVideos.size / (numRequests * 50) * 100).toFixed(1)}%`);
  console.log("  (100% = perfect randomness, <80% = concerning)");
}

testRandomness().catch(console.error);