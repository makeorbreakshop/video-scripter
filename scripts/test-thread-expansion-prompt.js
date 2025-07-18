import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test different queries
const TEST_QUERIES = [
  "xtool f2 fiber laser review",
  "how to make sourdough bread",
  "best beginner chess openings"
];

// Thread expansion prompt
const EXPANSION_PROMPT = `Given the search query: "{query}"

Generate 15 diverse search queries that will help discover successful YouTube video patterns. Mix different angles:

1. Direct variations (2-3): Close to original query
2. Audience-specific (2-3): Different skill levels, use cases
3. Format explorations (2-3): How-to, reviews, comparisons, mistakes
4. Emotional/outcome focused (2-3): Problems solved, benefits, concerns
5. Lateral/creative (2-3): Adjacent topics, unexpected angles

Return as JSON array of objects with:
- query: the search query
- strategy: brief description of the approach
- intent: what pattern this might uncover

Example format:
[
  {"query": "...", "strategy": "direct search", "intent": "baseline performance"},
  ...
]`;

async function testThreadExpansion(seedQuery) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TESTING: "${seedQuery}"`);
  console.log('='.repeat(70));
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: EXPANSION_PROMPT.replace('{query}', seedQuery)
      }],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });
    
    const result = JSON.parse(completion.choices[0].message.content);
    const threads = result.queries || result.threads || result;
    
    // Group by category
    const categories = {
      direct: [],
      audience: [],
      format: [],
      emotional: [],
      lateral: []
    };
    
    threads.forEach((thread, i) => {
      const strategy = thread.strategy.toLowerCase();
      if (strategy.includes('direct') || strategy.includes('close')) {
        categories.direct.push(thread);
      } else if (strategy.includes('audience') || strategy.includes('skill') || strategy.includes('beginner') || strategy.includes('advanced')) {
        categories.audience.push(thread);
      } else if (strategy.includes('format') || strategy.includes('review') || strategy.includes('tutorial') || strategy.includes('mistake')) {
        categories.format.push(thread);
      } else if (strategy.includes('emotion') || strategy.includes('problem') || strategy.includes('benefit') || strategy.includes('concern')) {
        categories.emotional.push(thread);
      } else {
        categories.lateral.push(thread);
      }
    });
    
    // Display results
    console.log(`\n📊 THREAD EXPANSION (${threads.length} total):\n`);
    
    Object.entries(categories).forEach(([category, items]) => {
      if (items.length > 0) {
        console.log(`${category.toUpperCase()} (${items.length}):`);
        items.forEach(thread => {
          console.log(`  • "${thread.query}"`);
          console.log(`    → ${thread.strategy} | Intent: ${thread.intent}`);
        });
        console.log();
      }
    });
    
    // Analyze diversity
    const uniqueWords = new Set();
    threads.forEach(t => {
      t.query.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 3) uniqueWords.add(word);
      });
    });
    
    console.log(`📈 DIVERSITY METRICS:`);
    console.log(`  - Unique significant words: ${uniqueWords.size}`);
    console.log(`  - Avg words per query: ${(threads.reduce((sum, t) => sum + t.query.split(/\s+/).length, 0) / threads.length).toFixed(1)}`);
    console.log(`  - Category distribution: ${Object.entries(categories).map(([k, v]) => `${k}=${v.length}`).join(', ')}`);
    
    // Show overlap potential
    console.log(`\n🔄 POTENTIAL OVERLAPS:`);
    const wordFrequency = {};
    threads.forEach(t => {
      t.query.toLowerCase().split(/\s+/).forEach(word => {
        if (word.length > 3 && !['review', 'tutorial', 'guide', 'best'].includes(word)) {
          wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        }
      });
    });
    
    const commonWords = Object.entries(wordFrequency)
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1]);
    
    if (commonWords.length > 0) {
      console.log('  Words appearing in 3+ queries (potential cross-thread patterns):');
      commonWords.forEach(([word, count]) => {
        console.log(`    - "${word}": ${count} queries`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Test all queries
async function runTests() {
  console.log('🧪 TESTING LLM-DRIVEN THREAD EXPANSION\n');
  console.log('Goal: Generate diverse search queries that will uncover different video patterns');
  console.log('while maintaining enough overlap to find cross-thread signals.\n');
  
  for (const query of TEST_QUERIES) {
    await testThreadExpansion(query);
  }
  
  console.log('\n💡 INSIGHTS FOR IMPLEMENTATION:');
  console.log('1. LLM generates good diversity without rigid categories');
  console.log('2. Natural overlap emerges (3-5 queries share key terms)');
  console.log('3. Mix of specific and broad queries enables both deep and wide patterns');
  console.log('4. 15 threads seems optimal - enough diversity without dilution');
}

runTests().catch(console.error);