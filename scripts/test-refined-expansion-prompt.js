import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Refined prompt based on test results
const REFINED_EXPANSION_PROMPT = `Create 15 diverse YouTube search queries for: "{query}"

Generate queries that explore different angles while maintaining some overlap for pattern discovery:
- Direct variations and updates
- Different skill levels and audiences  
- Various content formats (tutorials, reviews, comparisons, mistakes)
- Problem-solving and outcomes
- Adjacent topics and creative angles

Ensure queries are specific enough to find focused content but broad enough to discover patterns.

Return as JSON array with these fields:
- query: the search string
- angle: what perspective this takes (e.g., "beginner-focused", "comparison", "troubleshooting")
- expected_videos: what types of videos this might find

Keep queries natural and YouTube-search-friendly.`;

async function testRefinedExpansion(seedQuery) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`QUERY: "${seedQuery}"`);
  console.log('='.repeat(70));
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: REFINED_EXPANSION_PROMPT.replace('{query}', seedQuery)
      }],
      response_format: { type: 'json_object' },
      temperature: 0.8, // Slightly higher for more creativity
    });
    
    const threads = JSON.parse(completion.choices[0].message.content);
    const threadArray = threads.queries || threads.threads || threads;
    
    console.log(`\n📊 GENERATED ${threadArray.length} SEARCH THREADS:\n`);
    
    // Group by angle type
    const angleGroups = {};
    threadArray.forEach((thread, i) => {
      const angle = thread.angle || 'general';
      if (!angleGroups[angle]) angleGroups[angle] = [];
      angleGroups[angle].push(thread);
      
      console.log(`${i + 1}. "${thread.query}"`);
      console.log(`   → ${thread.angle} | ${thread.expected_videos}`);
    });
    
    // Analyze overlap
    console.log(`\n🔄 OVERLAP ANALYSIS:`);
    const wordMap = {};
    threadArray.forEach(t => {
      const words = t.query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      words.forEach(word => {
        if (!wordMap[word]) wordMap[word] = { count: 0, queries: [] };
        wordMap[word].count++;
        wordMap[word].queries.push(t.query);
      });
    });
    
    const sharedWords = Object.entries(wordMap)
      .filter(([word, data]) => data.count >= 3)
      .sort((a, b) => b[1].count - a[1].count);
    
    console.log('\nWords appearing in 3+ queries (potential cross-thread patterns):');
    sharedWords.slice(0, 10).forEach(([word, data]) => {
      console.log(`  • "${word}": ${data.count} queries`);
    });
    
    // Predict pattern types
    console.log(`\n🎯 PREDICTED PATTERN DISCOVERY:`);
    
    // Find potential wide patterns (queries that might overlap)
    const potentialWidePatterns = [];
    sharedWords.forEach(([word, data]) => {
      if (data.count >= 4 && !['best', 'guide', 'tutorial'].includes(word)) {
        potentialWidePatterns.push({
          keyword: word,
          queries: data.queries.slice(0, 3),
          strength: data.count
        });
      }
    });
    
    if (potentialWidePatterns.length > 0) {
      console.log('\nPotential WIDE patterns (cross-thread signals):');
      potentialWidePatterns.forEach(pattern => {
        console.log(`  • "${pattern.keyword}" pattern (${pattern.strength} threads)`);
        pattern.queries.forEach(q => {
          console.log(`    - ${q}`);
        });
      });
    }
    
    // Cost estimate
    console.log(`\n💰 ESTIMATED SEARCH COST:`);
    console.log(`  • ${threadArray.length} threads × 50 videos = ~750 vector searches`);
    console.log(`  • Pinecone cost: ~$0.0001`);
    console.log(`  • OpenAI embeddings: ~$0.01`);
    console.log(`  • Pattern analysis: ~$0.002`);
    console.log(`  • Total: ~$0.012 per complete search`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Test queries
async function runTests() {
  console.log('🚀 REFINED THREAD EXPANSION TEST\n');
  
  const queries = [
    "xtool f2 fiber laser review",
    "how to start a youtube channel",
    "python vs javascript for beginners"
  ];
  
  for (const query of queries) {
    await testRefinedExpansion(query);
  }
  
  console.log('\n✅ READY FOR IMPLEMENTATION');
  console.log('Next steps:');
  console.log('1. Implement thread expansion in API');
  console.log('2. Add provenance tracking to video results');
  console.log('3. Build clustering pipeline');
  console.log('4. Update UI to show cross-thread patterns');
}

runTests().catch(console.error);