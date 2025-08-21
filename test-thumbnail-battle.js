// Test script for Thumbnail Battle game

async function testBattle() {
  console.log('Testing Thumbnail Battle API...\n');

  try {
    // Test 1: Get matchup
    console.log('Test 1: Fetching matchup...');
    const response = await fetch('http://localhost:3000/api/thumbnail-battle/get-matchup');
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Failed to get matchup:', data.error);
      return;
    }

    console.log('✅ Got matchup successfully');
    console.log('\nVideo A:');
    console.log(`  Title: ${data.videoA.title}`);
    console.log(`  Channel: ${data.videoA.channel_title}`);
    console.log(`  Performance: ${data.videoA.temporal_performance_score}x baseline`);
    console.log(`  Views: ${data.videoA.view_count.toLocaleString()}`);
    
    console.log('\nVideo B:');
    console.log(`  Title: ${data.videoB.title}`);
    console.log(`  Channel: ${data.videoB.channel_title}`);
    console.log(`  Performance: ${data.videoB.temporal_performance_score}x baseline`);
    console.log(`  Views: ${data.videoB.view_count.toLocaleString()}`);

    // Test 2: Determine winner
    const winner = data.videoA.temporal_performance_score > data.videoB.temporal_performance_score ? 'A' : 'B';
    console.log(`\n✅ Winner is Video ${winner} with ${Math.max(data.videoA.temporal_performance_score, data.videoB.temporal_performance_score)}x baseline performance`);

    // Test 3: Multiple requests to ensure randomization
    console.log('\nTest 2: Testing randomization (5 requests)...');
    const positions = { A_wins: 0, B_wins: 0 };
    
    for (let i = 0; i < 5; i++) {
      const r = await fetch('http://localhost:3000/api/thumbnail-battle/get-matchup');
      const d = await r.json();
      if (d.videoA && d.videoB) {
        if (d.videoA.temporal_performance_score > d.videoB.temporal_performance_score) {
          positions.A_wins++;
        } else {
          positions.B_wins++;
        }
      }
    }
    
    console.log(`✅ Position A had winner: ${positions.A_wins} times`);
    console.log(`✅ Position B had winner: ${positions.B_wins} times`);
    console.log('(Should be roughly balanced for good randomization)');

    // Test 4: Check data validity
    console.log('\nTest 3: Data validation...');
    const validationErrors = [];
    
    if (!data.videoA.thumbnail_url || !data.videoA.thumbnail_url.includes('http')) {
      validationErrors.push('Video A missing valid thumbnail URL');
    }
    if (!data.videoB.thumbnail_url || !data.videoB.thumbnail_url.includes('http')) {
      validationErrors.push('Video B missing valid thumbnail URL');
    }
    if (typeof data.videoA.temporal_performance_score !== 'number') {
      validationErrors.push('Video A missing performance score');
    }
    if (typeof data.videoB.temporal_performance_score !== 'number') {
      validationErrors.push('Video B missing performance score');
    }
    if (data.videoA.id === data.videoB.id) {
      validationErrors.push('Same video appears twice!');
    }

    if (validationErrors.length === 0) {
      console.log('✅ All data validation passed');
    } else {
      console.log('❌ Validation errors:');
      validationErrors.forEach(err => console.log(`   - ${err}`));
    }

    console.log('\n✅ All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testBattle();