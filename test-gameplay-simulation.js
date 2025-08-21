// Simulate actual gameplay to test streak mechanics

async function simulateGameplay() {
  console.log('🎮 THUMBNAIL BATTLE GAMEPLAY SIMULATION\n');
  console.log('=' .repeat(50));
  
  let streak = 0;
  let round = 1;
  let gameOver = false;

  while (!gameOver) {
    console.log(`\n📸 ROUND ${round}`);
    console.log('-'.repeat(30));
    
    // Fetch matchup
    const response = await fetch('http://localhost:3000/api/thumbnail-battle/get-matchup');
    const data = await response.json();
    
    if (!response.ok) {
      console.error('Failed to get matchup');
      break;
    }

    // Display matchup
    console.log('\nVideo A:');
    console.log(`  "${data.videoA.title.substring(0, 50)}..."`);
    console.log(`  by ${data.videoA.channel_title}`);
    
    console.log('\nVideo B:');
    console.log(`  "${data.videoB.title.substring(0, 50)}..."`);
    console.log(`  by ${data.videoB.channel_title}`);

    // Determine correct answer
    const correct = data.videoA.temporal_performance_score > data.videoB.temporal_performance_score ? 'A' : 'B';
    
    // Simulate player choice (70% chance of being right to make streaks interesting)
    const playerChoice = Math.random() < 0.7 ? correct : (correct === 'A' ? 'B' : 'A');
    
    console.log(`\n🤔 Player chooses: Video ${playerChoice}`);
    
    // Check if correct
    const isCorrect = playerChoice === correct;
    
    if (isCorrect) {
      streak++;
      console.log(`✅ CORRECT! Video ${correct} performed better`);
      console.log(`   Video A: ${data.videoA.temporal_performance_score.toFixed(1)}x baseline`);
      console.log(`   Video B: ${data.videoB.temporal_performance_score.toFixed(1)}x baseline`);
      console.log(`\n🔥 Streak: ${streak}`);
      round++;
    } else {
      console.log(`❌ WRONG! Video ${correct} actually performed better`);
      console.log(`   Video A: ${data.videoA.temporal_performance_score.toFixed(1)}x baseline`);
      console.log(`   Video B: ${data.videoB.temporal_performance_score.toFixed(1)}x baseline`);
      console.log(`\n💀 GAME OVER!`);
      console.log(`Final Streak: ${streak}`);
      gameOver = true;
    }

    // Small delay to simulate thinking time
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(50));
  console.log('🏆 GAME SUMMARY');
  console.log(`   Rounds Played: ${round - 1}`);
  console.log(`   Final Streak: ${streak}`);
  console.log(`   Score Rating: ${getScoreRating(streak)}`);
  console.log('='.repeat(50));
}

function getScoreRating(streak) {
  if (streak === 0) return '😢 Better luck next time!';
  if (streak <= 2) return '👍 Not bad!';
  if (streak <= 5) return '🎯 Good eye!';
  if (streak <= 10) return '🔥 Impressive!';
  if (streak <= 15) return '🚀 Outstanding!';
  return '🏆 LEGENDARY!';
}

simulateGameplay().catch(console.error);