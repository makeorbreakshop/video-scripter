const fs = require('fs');
const path = require('path');

function analyzeSearchLog(logPath) {
  try {
    const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    
    console.log('🔍 SEARCH LOG ANALYSIS');
    console.log('='.repeat(50));
    console.log(`📅 Timestamp: ${logData.timestamp}`);
    console.log(`🎯 Concept: "${logData.concept}"`);
    console.log(`📊 Total Processing Time: ${logData.totalProcessingTime}ms`);
    console.log(`💰 Total Cost: $${logData.costs.totalCost.toFixed(4)}`);
    console.log('');
    
    // Query Analysis
    console.log('📈 QUERY EXPANSION');
    console.log('-'.repeat(30));
    console.log(`Original: "${logData.concept}"`);
    console.log('Expanded:');
    logData.expandedQueries.forEach((query, i) => {
      console.log(`  ${i + 1}. "${query}"`);
    });
    console.log('');
    
    // Search Results Analysis
    console.log('🔍 SEARCH RESULTS ANALYSIS');
    console.log('-'.repeat(30));
    console.log(`Total Videos Found: ${logData.searchResults.length}`);
    console.log(`Relevance: ${logData.analysis.relevancePercentage.toFixed(1)}%`);
    console.log(`Average Similarity: ${logData.analysis.similarityAnalysis.averageSimilarity.toFixed(3)}`);
    console.log(`High Performers (3x+): ${logData.analysis.performanceAnalysis.highPerformers}`);
    console.log(`Super Stars (10x+): ${logData.analysis.performanceAnalysis.superStars}`);
    console.log('');
    
    // Performance Distribution
    console.log('📊 PERFORMANCE DISTRIBUTION');
    console.log('-'.repeat(30));
    console.log(`🌟 Superstar (10x+): ${logData.performanceDistribution.superstar || 0}`);
    console.log(`💪 Strong (3-10x): ${logData.performanceDistribution.strong || 0}`);
    console.log(`✅ Above Avg (1.5-3x): ${logData.performanceDistribution.above_avg || 0}`);
    console.log(`📊 Normal (<1.5x): ${logData.performanceDistribution.normal || 0}`);
    console.log('');
    
    // Top Channels
    console.log('📺 TOP CHANNELS');
    console.log('-'.repeat(30));
    logData.analysis.topChannels.slice(0, 10).forEach((channel, i) => {
      console.log(`${i + 1}. ${channel.channel}: ${channel.count} videos`);
    });
    console.log('');
    
    // Topic Analysis
    console.log('🏷️ TOPIC ANALYSIS');
    console.log('-'.repeat(30));
    console.log('Top Topics:');
    logData.analysis.topicAnalysis.topTopics.slice(0, 10).forEach((topic, i) => {
      console.log(`${i + 1}. "${topic.topic}": ${topic.count} occurrences (${topic.percentage.toFixed(1)}%)`);
    });
    
    if (logData.analysis.topicAnalysis.unexpectedTopics.length > 0) {
      console.log('\n⚠️ Unexpected Topics:');
      logData.analysis.topicAnalysis.unexpectedTopics.forEach(topic => {
        console.log(`- "${topic.topic}": ${topic.count} occurrences (${topic.percentage.toFixed(1)}%)`);
      });
    }
    console.log('');
    
    // Issues
    if (logData.analysis.potentialIssues.length > 0) {
      console.log('🚨 POTENTIAL ISSUES');
      console.log('-'.repeat(30));
      logData.analysis.potentialIssues.forEach(issue => {
        console.log(`${issue.severity.toUpperCase()}: ${issue.message}`);
        if (issue.examples) {
          console.log('Examples:');
          issue.examples.forEach(example => console.log(`  - ${example}`));
        }
      });
      console.log('');
    }
    
    // Sample Videos
    console.log('📹 SAMPLE VIDEOS (Top 20 by similarity)');
    console.log('-'.repeat(30));
    logData.searchResults
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 20)
      .forEach((video, i) => {
        const relevanceMarker = logData.concept.toLowerCase().split(' ').some(word => 
          video.title.toLowerCase().includes(word)
        ) ? '✅' : '❌';
        
        console.log(`${i + 1}. ${relevanceMarker} [${video.similarityScore.toFixed(3)}] [${video.performanceRatio.toFixed(1)}x] ${video.title}`);
        console.log(`    📺 ${video.channelName} • ${video.viewCount.toLocaleString()} views`);
      });
    
    // Patterns
    console.log('\n🧠 DISCOVERED PATTERNS');
    console.log('-'.repeat(30));
    logData.discoveredPatterns.forEach((pattern, i) => {
      console.log(`${i + 1}. ${pattern.pattern} (${pattern.performance_multiplier}x, ${(pattern.confidence * 100).toFixed(0)}%)`);
      console.log(`    Template: ${pattern.template}`);
      console.log(`    Examples: ${pattern.examples.join(' • ')}`);
    });
    
  } catch (error) {
    console.error('Error analyzing search log:', error);
  }
}

// Get the most recent log file if no argument provided
function getLatestLogFile() {
  const logsDir = path.join(process.cwd(), 'search-logs');
  const files = fs.readdirSync(logsDir)
    .filter(file => file.endsWith('.json'))
    .map(file => ({
      name: file,
      path: path.join(logsDir, file),
      mtime: fs.statSync(path.join(logsDir, file)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return files.length > 0 ? files[0].path : null;
}

// Main execution
const logPath = process.argv[2] || getLatestLogFile();

if (!logPath) {
  console.error('No log file found. Run a search first.');
  process.exit(1);
}

if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(1);
}

console.log(`Analyzing: ${path.basename(logPath)}`);
console.log('');

analyzeSearchLog(logPath);