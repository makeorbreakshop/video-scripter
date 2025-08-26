// Test the similar matchup endpoint

async function testSimilarMatchup() {
  console.log('🧪 Testing Similar Matchup Endpoint\n');
  console.log('=' .repeat(50));
  
  try {
    // Test 1: Get a similar matchup
    console.log('\nTest 1: Fetching similar matchup...');
    const response = await fetch('http://localhost:3000/api/thumbnail-battle/get-similar-matchup');
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to get matchup:', data.error);
      return;
    }

    console.log('✅ Got matchup successfully');
    console.log(`   Similarity type: ${data.similarity_type}`);
    console.log(`   Processing time: ${data.processing_time_ms}ms`);
    
    console.log('\nVideo A:');
    console.log(`  Title: ${data.videoA.title}`);
    console.log(`  Performance: ${data.videoA.temporal_performance_score.toFixed(1)}x baseline`);
    console.log(`  Views: ${data.videoA.view_count.toLocaleString()}`);
    if (data.videoA.topic) console.log(`  Topic: ${data.videoA.topic}`);
    if (data.videoA.format) console.log(`  Format: ${data.videoA.format}`);
    
    console.log('\nVideo B:');
    console.log(`  Title: ${data.videoB.title}`);
    console.log(`  Performance: ${data.videoB.temporal_performance_score.toFixed(1)}x baseline`);
    console.log(`  Views: ${data.videoB.view_count.toLocaleString()}`);
    if (data.videoB.topic) console.log(`  Topic: ${data.videoB.topic}`);
    if (data.videoB.format) console.log(`  Format: ${data.videoB.format}`);

    // Test 2: Performance consistency
    console.log('\n\nTest 2: Performance consistency (5 requests)...');
    const times = [];
    const types = {};
    
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      const r = await fetch('http://localhost:3000/api/thumbnail-battle/get-similar-matchup');
      const d = await r.json();
      const elapsed = Date.now() - start;
      
      times.push(elapsed);
      types[d.similarity_type] = (types[d.similarity_type] || 0) + 1;
      
      console.log(`  Request ${i + 1}: ${elapsed}ms (${d.similarity_type})`);
    }
    
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`\n✅ Average response time: ${avgTime.toFixed(0)}ms`);
    console.log('   Similarity types used:', types);
    
    // Test 3: Verify videos are similar (if topic-based)
    if (data.similarity_type === 'topic_based') {
      console.log('\n\nTest 3: Topic/Format similarity check...');
      
      const sameTopic = data.videoA.topic === data.videoB.topic;
      const sameFormat = data.videoA.format === data.videoB.format;
      
      console.log(`  Same topic: ${sameTopic ? '✅' : '❌'} (${data.videoA.topic} vs ${data.videoB.topic})`);
      console.log(`  Same format: ${sameFormat ? '✅' : '❌'} (${data.videoA.format} vs ${data.videoB.format})`);
      
      if (sameTopic || sameFormat) {
        console.log('  ✅ Videos have similar content characteristics');
      }
    }
    
    // Test 4: Performance difference check
    console.log('\n\nTest 4: Performance difference validation...');
    const scoreA = data.videoA.temporal_performance_score;
    const scoreB = data.videoB.temporal_performance_score;
    const highPerformer = scoreA > scoreB ? 'A' : 'B';
    const lowPerformer = scoreA < scoreB ? 'A' : 'B';
    const highScore = Math.max(scoreA, scoreB);
    const lowScore = Math.min(scoreA, scoreB);
    
    console.log(`  High performer: Video ${highPerformer} (${highScore.toFixed(1)}x)`);
    console.log(`  Low performer: Video ${lowPerformer} (${lowScore.toFixed(1)}x)`);
    
    if (highScore >= 1.5 && lowScore <= 0.8) {
      console.log('  ✅ Clear performance difference (ideal matchup)');
    } else if (highScore > lowScore * 1.5) {
      console.log('  ✅ Good performance difference');
    } else {
      console.log('  ⚠️ Similar performance levels (less ideal for game)');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ All tests completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testSimilarMatchup();