const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testToolsQueryImprovement() {
  console.log("Testing improved prompts for problematic queries...\n");

  // Test 1: Original problematic expansion
  console.log("=== TEST 1: Original Query Expansion (PROBLEMATIC) ===");
  const originalPrompt = `Generate 6 search queries related to "how to cook a steak". These should be variations that explore different aspects while maintaining relevance.`;
  
  const originalResult = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: originalPrompt }],
    temperature: 0.7
  });
  
  console.log("Original expansion (leads to 'essential tools' problem):");
  console.log(originalResult.choices[0].message.content);

  // Test 2: Domain-aware expansion
  console.log("\n=== TEST 2: Domain-Aware Query Expansion (IMPROVED) ===");
  const improvedPrompt = `You are generating YouTube search queries for: "how to cook a steak"

First, identify the domain context:
- Primary domain: cooking/culinary
- Key context words: kitchen, chef, recipe, food, grill, pan, oven
- Avoid mixing with: tools/hardware stores, metalworking, construction

Generate 6 search queries that:
1. Stay within the cooking/culinary domain
2. Use cooking-specific terminology
3. Would find videos from cooking channels, not DIY/craft channels

Format each query to be specific to cooking content.`;

  const improvedResult = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: improvedPrompt }],
    temperature: 0.7
  });

  console.log("Improved domain-aware expansion:");
  console.log(improvedResult.choices[0].message.content);

  // Test 3: Context reinforcement for ambiguous terms
  console.log("\n=== TEST 3: Handling Ambiguous Terms (TOOLS) ===");
  const contextPrompt = `The user searched for "how to cook a steak". They want to find cooking videos.

One expansion might include "tools" or "equipment". Rewrite this query to be unambiguous:
"essential tools for cooking steak"

Rewrite to ensure it finds KITCHEN/COOKING content, not workshop/hardware content:`;

  const contextResult = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: contextPrompt }],
    temperature: 0.7
  });

  console.log("Original ambiguous: 'essential tools for cooking steak'");
  console.log("Cooking-specific rewrite:", contextResult.choices[0].message.content);

  // Test 4: Post-search coherence check
  console.log("\n=== TEST 4: Coherence Check for Mixed Results ===");
  const coherencePrompt = `A user searched for "how to cook a steak" and got these video titles:
1. "How To Cook The Perfect Steak"
2. "4 Common Mistakes That Ruin a Flat Table Top" 
3. "I Bought Amazon Blacksmithing Tools"
4. "Best Steak Cooking Techniques"
5. "8 Essential Welding Tools (All For Under $50)"

Analyze:
1. Which videos are relevant to cooking steak? (list video numbers)
2. Which are off-topic? (list video numbers) 
3. What patterns indicate off-topic content?
4. Coherence score (0-1) for how well results match intent:

Return as JSON.`;

  const coherenceResult = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: coherencePrompt }],
    temperature: 0.3,
    response_format: { type: "json_object" }
  });

  console.log("Coherence analysis:");
  console.log(JSON.parse(coherenceResult.choices[0].message.content));
}

testToolsQueryImprovement().catch(console.error);