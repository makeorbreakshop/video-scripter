import dotenv from 'dotenv';
dotenv.config();

// Test query
const SEED_QUERY = "how to make sourdough bread";

// Call our actual API
async function testPoolAndClusterWithAPI() {
  console.log('🚀 TESTING POOL-AND-CLUSTER APPROACH WITH ACTUAL API');
  console.log('=' + '='.repeat(60));
  console.log(`Seed query: "${SEED_QUERY}"\n`);
  
  try {
    // Call our pattern generation API
    console.log('🔍 CALLING PATTERN GENERATION API...');
    const response = await fetch('http://localhost:3000/api/youtube/patterns/generate-titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        concept: SEED_QUERY,
        options: {
          maxSuggestions: 15,
          includeExamples: true
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`API failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`\n✓ Received ${data.suggestions?.length || 0} title suggestions`);
    console.log(`Total videos analyzed: ${data.metadata?.totalVideosAnalyzed || 'N/A'}`);
    console.log(`Unique channels: ${data.metadata?.uniqueChannels || 'N/A'}`);
    
    // Analyze thread contributions
    console.log(`\n📊 THREAD ANALYSIS`);
    console.log('=' + '='.repeat(60));
    
    // Track which threads contributed to patterns
    const threadContributions = {};
    const patternsByThread = {};
    
    data.suggestions?.forEach(suggestion => {
      const thread = suggestion.pattern.source_thread || 'unknown';
      threadContributions[thread] = (threadContributions[thread] || 0) + 1;
      
      if (!patternsByThread[thread]) {
        patternsByThread[thread] = [];
      }
      patternsByThread[thread].push(suggestion.pattern.name);
    });
    
    console.log('\nThread contribution count:');
    Object.entries(threadContributions)
      .sort((a, b) => b[1] - a[1])
      .forEach(([thread, count]) => {
        console.log(`  ${thread}: ${count} patterns`);
      });
    
    // Show patterns by type (wide vs deep)
    console.log(`\n🔮 PATTERN DISCOVERY`);
    console.log('=' + '='.repeat(60));
    
    // Group suggestions by performance
    const highPerformers = data.suggestions?.filter(s => s.pattern.performance_lift > 2) || [];
    const solidPerformers = data.suggestions?.filter(s => s.pattern.performance_lift > 1.5 && s.pattern.performance_lift <= 2) || [];
    
    console.log(`\nHigh performers (>2x): ${highPerformers.length}`);
    highPerformers.slice(0, 3).forEach((s, i) => {
      console.log(`\n${i + 1}. "${s.title}"`);
      console.log(`   Pattern: ${s.pattern.name}`);
      console.log(`   Performance: ${s.pattern.performance_lift.toFixed(1)}x`);
      console.log(`   Evidence: ${s.evidence.sample_size} videos`);
      console.log(`   Thread: ${s.pattern.source_thread || 'N/A'}`);
      if (s.pattern.examples?.length > 0) {
        console.log('   Examples:');
        s.pattern.examples.slice(0, 2).forEach(ex => {
          console.log(`     • ${ex}`);
        });
      }
    });
    
    console.log(`\nSolid performers (1.5-2x): ${solidPerformers.length}`);
    
    // Show cross-thread patterns (if we can identify them)
    console.log(`\n🌊 CROSS-THREAD PATTERNS`);
    console.log('=' + '='.repeat(60));
    
    // Look for similar patterns across threads
    const patternGroups = {};
    data.suggestions?.forEach(suggestion => {
      const patternKey = suggestion.pattern.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!patternGroups[patternKey]) {
        patternGroups[patternKey] = {
          name: suggestion.pattern.name,
          threads: new Set(),
          suggestions: []
        };
      }
      patternGroups[patternKey].threads.add(suggestion.pattern.source_thread || 'unknown');
      patternGroups[patternKey].suggestions.push(suggestion);
    });
    
    const crossThreadPatterns = Object.values(patternGroups)
      .filter(g => g.threads.size > 1)
      .sort((a, b) => b.threads.size - a.threads.size);
    
    if (crossThreadPatterns.length > 0) {
      console.log(`\nFound ${crossThreadPatterns.length} patterns appearing across multiple threads:`);
      crossThreadPatterns.slice(0, 3).forEach((pattern, i) => {
        console.log(`\n${i + 1}. "${pattern.name}"`);
        console.log(`   Threads: ${Array.from(pattern.threads).join(', ')}`);
        console.log(`   Variations: ${pattern.suggestions.length}`);
      });
    } else {
      console.log('\nNo cross-thread patterns detected (patterns may need more diverse thread strategies)');
    }
    
    // Cost analysis
    console.log(`\n💰 COST ANALYSIS`);
    console.log('=' + '='.repeat(60));
    if (data.metadata?.costs) {
      console.log(`\nVector search: $${data.metadata.costs.vectorSearch?.toFixed(4) || '0.0000'}`);
      console.log(`OpenAI GPT-4o-mini: $${data.metadata.costs.openai?.toFixed(4) || '0.0000'}`);
      console.log(`Total cost: $${data.metadata.costs.total?.toFixed(4) || '0.0000'}`);
      console.log(`\nTokens used:`);
      console.log(`  Input: ${data.metadata.costs.openaiInputTokens || 0}`);
      console.log(`  Output: ${data.metadata.costs.openaiOutputTokens || 0}`);
    }
    
    // Debug info
    if (data.debug) {
      console.log(`\n🐛 DEBUG INFO`);
      console.log('=' + '='.repeat(60));
      console.log(`\nExpansion threads: ${data.debug.expansion?.threads?.length || 0}`);
      data.debug.expansion?.threads?.forEach((thread, i) => {
        console.log(`  ${i + 1}. [${thread.strategy}] "${thread.query}" → ${thread.videos || 0} videos`);
      });
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run test
testPoolAndClusterWithAPI().catch(console.error);