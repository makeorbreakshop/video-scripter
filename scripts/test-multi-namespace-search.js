/**
 * Test script for multi-namespace semantic search in Idea Heist
 */

const API_BASE = 'http://localhost:3000/api';

async function testMultiNamespaceSearch() {
  try {
    console.log('🧪 Testing Multi-Namespace Search for Idea Heist\n');
    
    // Step 1: Get an outlier video
    console.log('1️⃣ Fetching outlier videos...');
    const outlierResponse = await fetch(`${API_BASE}/idea-radar?limit=5&minScore=5`);
    
    if (!outlierResponse.ok) {
      throw new Error(`Failed to fetch outliers: ${outlierResponse.status}`);
    }
    
    const outlierData = await outlierResponse.json();
    
    if (!outlierData.outliers || outlierData.outliers.length === 0) {
      console.log('No outliers found. Try adjusting the filters.');
      return;
    }
    
    const targetVideo = outlierData.outliers[0];
    console.log(`   Found outlier: "${targetVideo.title}"`);
    console.log(`   Score: ${targetVideo.score.toFixed(1)}x, Views: ${targetVideo.views.toLocaleString()}\n`);
    
    // Step 2: Analyze pattern with multi-namespace search
    console.log('2️⃣ Analyzing pattern with multi-namespace search...');
    const startTime = Date.now();
    
    const analyzeResponse = await fetch(`${API_BASE}/analyze-pattern`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_id: targetVideo.video_id
      })
    });
    
    if (!analyzeResponse.ok) {
      const error = await analyzeResponse.text();
      throw new Error(`Failed to analyze pattern: ${analyzeResponse.status} - ${error}`);
    }
    
    const analysisData = await analyzeResponse.json();
    const processingTime = Date.now() - startTime;
    
    console.log(`   ✅ Analysis complete in ${processingTime}ms\n`);
    
    // Display pattern information
    console.log('📊 Pattern Extracted:');
    console.log(`   Name: ${analysisData.pattern.pattern_name}`);
    console.log(`   Description: ${analysisData.pattern.pattern_description}`);
    console.log(`   Psychological Trigger: ${analysisData.pattern.psychological_trigger}`);
    console.log(`   Semantic Queries: ${analysisData.pattern.semantic_queries.join(', ')}\n`);
    
    // Display validation results
    console.log('🔍 Validation Results:');
    console.log(`   Total Validations: ${analysisData.validation.total_validations}`);
    console.log(`   Pattern Strength: ${analysisData.validation.pattern_strength}`);
    console.log(`   Average Score: ${analysisData.validation.avg_pattern_score.toFixed(2)}x\n`);
    
    // Show top validated videos with reasons
    console.log('✅ Top Validated Videos (with reasoning):');
    let videoCount = 0;
    analysisData.validation.results.slice(0, 3).forEach(niche => {
      console.log(`\n   ${niche.niche} (${niche.count} videos, avg ${niche.avg_score.toFixed(1)}x):`);
      niche.videos.slice(0, 2).forEach(video => {
        videoCount++;
        console.log(`   ${videoCount}. "${video.title}"`);
        console.log(`      Score: ${video.score.toFixed(1)}x | Channel: ${video.channel}`);
        if (video.validation_reason) {
          console.log(`      ✓ Reason: ${video.validation_reason}`);
        }
        if (video.source) {
          console.log(`      📍 Found via: ${video.source} search`);
        }
      });
    });
    
    console.log('\n✅ Multi-namespace search test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testMultiNamespaceSearch();