#!/usr/bin/env node

const testConfigurations = [
  // Small datasets (should be fast)
  { name: "Day/High threshold", params: "timeRange=day&minScore=3&minViews=100000&randomize=true&limit=20" },
  { name: "Week/Medium filters", params: "timeRange=week&minScore=3&minViews=10000&randomize=true&limit=50" },
  
  // Medium datasets (testing optimization)
  { name: "Month/Low threshold", params: "timeRange=month&minScore=2&minViews=1000&randomize=true&limit=50" },
  { name: "Quarter/Medium", params: "timeRange=quarter&minScore=2.5&minViews=10000&randomize=true&limit=50" },
  
  // Large datasets (stress test)
  { name: "Year/High volume", params: "timeRange=year&minScore=2&minViews=1000&randomize=true&limit=50" },
  { name: "2 Years/Low bar", params: "timeRange=twoyears&minScore=1.5&minViews=1000&randomize=true&limit=50" },
  
  // Non-random comparison
  { name: "Week/Non-random", params: "timeRange=week&minScore=3&minViews=10000&randomize=false&limit=50" },
  { name: "Month/Non-random", params: "timeRange=month&minScore=2&minViews=1000&randomize=false&limit=50" },
];

async function testEndpoint(config) {
  const url = `http://localhost:3000/api/idea-radar?${config.params}`;
  const startTime = Date.now();
  
  try {
    const response = await fetch(url);
    const elapsed = Date.now() - startTime;
    
    if (!response.ok) {
      const error = await response.text();
      return {
        name: config.name,
        status: "❌ FAILED",
        time: `${(elapsed/1000).toFixed(2)}s`,
        error: error.substring(0, 100)
      };
    }
    
    const data = await response.json();
    return {
      name: config.name,
      status: elapsed > 8000 ? "⚠️  SLOW" : "✅ OK",
      time: `${(elapsed/1000).toFixed(2)}s`,
      videos: data.outliers?.length || 0,
      total: data.total || data.totalMatching || 0
    };
  } catch (error) {
    return {
      name: config.name,
      status: "❌ ERROR",
      time: `${((Date.now() - startTime)/1000).toFixed(2)}s`,
      error: error.message
    };
  }
}

async function runTests() {
  console.log("🧪 Testing Idea Radar API Performance");
  console.log("=" .repeat(70));
  
  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  for (const config of testConfigurations) {
    const result = await testEndpoint(config);
    
    console.log(`\n${result.status} ${result.name}`);
    console.log(`   Time: ${result.time}`);
    if (result.videos !== undefined) {
      console.log(`   Returned: ${result.videos} videos from ${result.total} total`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
  
  console.log("\n" + "=".repeat(70));
  console.log("✨ Test suite complete");
}

runTests().catch(console.error);