// Test the scoring logic for Thumbnail Battle
// Formula: 
// - Under 0.5 seconds: 1000 points
// - 0.5 to 10 seconds: Linear decrease from 1000 to 500
// - Over 10 seconds: 500 points

function calculatePoints(decisionTimeMs) {
  let pointsEarned = 0;
  
  if (decisionTimeMs <= 500) {
    // Grace period - full points
    pointsEarned = 1000;
  } else if (decisionTimeMs >= 10000) {
    // Too slow - minimum points
    pointsEarned = 500;
  } else {
    // Linear decrease from 1000 to 500 over 9.5 seconds (500ms to 10000ms)
    const timeRange = 10000 - 500; // 9500ms range
    const timeInRange = decisionTimeMs - 500; // How far into the range
    const percentThroughRange = timeInRange / timeRange;
    const pointsLost = 500 * percentThroughRange;
    pointsEarned = Math.floor(1000 - pointsLost);
  }
  
  return pointsEarned;
}

// Test cases
const testCases = [
  { ms: 100, expected: 1000, description: "Instant click (0.1s)" },
  { ms: 250, expected: 1000, description: "Very quick (0.25s)" },
  { ms: 500, expected: 1000, description: "Grace period boundary (0.5s)" },
  { ms: 1000, expected: 973, description: "1 second" },
  { ms: 2000, expected: 921, description: "2 seconds" },
  { ms: 3000, expected: 868, description: "3 seconds" },
  { ms: 4000, expected: 815, description: "4 seconds" },
  { ms: 5000, expected: 763, description: "5 seconds" },
  { ms: 6000, expected: 710, description: "6 seconds" },
  { ms: 7000, expected: 657, description: "7 seconds" },
  { ms: 8000, expected: 605, description: "8 seconds" },
  { ms: 8600, expected: 573, description: "8.6 seconds (your example)" },
  { ms: 9000, expected: 552, description: "9 seconds" },
  { ms: 10000, expected: 500, description: "10 seconds (minimum)" },
  { ms: 15000, expected: 500, description: "15 seconds (still minimum)" }
];

console.log("Thumbnail Battle Scoring Test\n");
console.log("Formula: 500 base + 500 bonus (decreasing over time)");
console.log("Grace period: 0-500ms = full 1000 points\n");
console.log("Time (sec) | Points | Description");
console.log("-----------|--------|-------------");

let allPassed = true;
testCases.forEach(test => {
  const actual = calculatePoints(test.ms);
  const seconds = (test.ms / 1000).toFixed(1);
  const passed = actual === test.expected;
  
  if (!passed) allPassed = false;
  
  console.log(
    `${seconds.padStart(10)} | ${actual.toString().padStart(6)} | ${test.description} ${passed ? '✓' : `✗ (expected ${test.expected})`}`
  );
});

console.log("\n" + (allPassed ? "✅ All tests passed!" : "❌ Some tests failed"));

// Simulate a game session
console.log("\n--- Simulating Game Session ---");
const sessionTimes = [800, 1200, 2500, 900, 3200, 1500, 600, 4000, 1100, 2000];
let totalScore = 0;

sessionTimes.forEach((time, index) => {
  const points = calculatePoints(time);
  totalScore += points;
  console.log(`Round ${index + 1}: ${(time/1000).toFixed(1)}s → ${points} points (total: ${totalScore})`);
});

console.log(`\nFinal score after 10 rounds: ${totalScore}`);
console.log(`Average points per round: ${Math.floor(totalScore / sessionTimes.length)}`);