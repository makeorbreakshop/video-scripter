import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Final optimized prompt
const THREAD_EXPANSION_PROMPT = `Generate 15 diverse YouTube search queries for: "{query}"

Create queries that explore different angles while maintaining overlap for pattern discovery:
- Direct variations (2-3)
- Audience/skill levels (2-3)  
- Content formats (tutorials, reviews, comparisons, mistakes) (3-4)
- Problems/outcomes/benefits (2-3)
- Adjacent/creative angles (2-3)

Return a JSON array of 15 objects with:
{
  "query": "the search string",
  "angle": "brief angle description",
  "intent": "what videos this will find"
}`;

async function testExpansion(seedQuery) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TESTING: "${seedQuery}"`);
  console.log('='.repeat(70));
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: THREAD_EXPANSION_PROMPT.replace('{query}', seedQuery)
      }],
      response_format: { type: 'json_object' },
      temperature: 0.8,
    });
    
    const result = JSON.parse(completion.choices[0].message.content);
    // Handle different possible response structures
    const threads = Array.isArray(result) ? result : (result.queries || result.threads || []);
    
    console.log(`\n✅ GENERATED ${threads.length} THREADS:\n`);
    
    threads.forEach((thread, i) => {
      console.log(`${i + 1}. "${thread.query}"`);
      console.log(`   ${thread.angle} → ${thread.intent}`);
    });
    
    // Analyze for pool-and-cluster potential
    console.log(`\n🔮 POOL-AND-CLUSTER POTENTIAL:`);
    
    // Find common terms
    const termFrequency = {};
    threads.forEach(t => {
      const words = t.query.toLowerCase().split(/\s+/)
        .filter(w => w.length > 3 && !['best', 'your', 'with', 'from', 'that'].includes(w));
      
      words.forEach(word => {
        termFrequency[word] = (termFrequency[word] || 0) + 1;
      });
    });
    
    const commonTerms = Object.entries(termFrequency)
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);
    
    console.log('\nTerms appearing in 3+ queries:');
    commonTerms.forEach(([term, count]) => {
      console.log(`  • "${term}": ${count} queries (potential cross-thread pattern)`);
    });
    
    // Estimate pattern discovery
    const widePatternCount = commonTerms.filter(([_, count]) => count >= 4).length;
    const deepPatternCount = threads.length - widePatternCount;
    
    console.log(`\n📊 EXPECTED PATTERNS:`);
    console.log(`  • Wide patterns (4+ threads): ~${widePatternCount}`);
    console.log(`  • Deep patterns (1-3 threads): ~${deepPatternCount}`);
    console.log(`  • Total unique patterns: ~${Math.floor(threads.length * 0.7)}`);
    
    return threads;
    
  } catch (error) {
    console.error('Error:', error);
    return [];
  }
}

// Main test
async function runFinalTest() {
  console.log('🚀 FINAL THREAD EXPANSION TEST\n');
  console.log('Testing our production-ready prompt...\n');
  
  const testQuery = "xtool f2 fiber laser review";
  const threads = await testExpansion(testQuery);
  
  if (threads.length > 0) {
    console.log('\n✅ READY TO BUILD!');
    console.log('\nImplementation plan:');
    console.log('1. Update generate-titles API to use this expansion');
    console.log('2. Search all threads in parallel (50 videos each)');
    console.log('3. Pool results with provenance tracking');
    console.log('4. Cluster by similarity (DBSCAN or simple clustering)');
    console.log('5. Prioritize wide patterns in UI');
    
    console.log('\n📝 Sample code structure:');
    console.log(`
// 1. Expand threads
const threads = await expandThreads(concept);

// 2. Search all threads
const searchPromises = threads.map(thread => 
  searchVideos(thread.query, { 
    limit: 50, 
    minPerformance: 1.5,
    trackThread: thread.angle 
  })
);
const threadResults = await Promise.all(searchPromises);

// 3. Pool with provenance
const pooledVideos = poolVideosWithProvenance(threadResults);

// 4. Cluster
const clusters = await clusterVideos(pooledVideos);

// 5. Generate patterns
const patterns = await analyzePatterns(clusters);
`);
  }
}

runFinalTest().catch(console.error);