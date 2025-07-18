const OpenAI = require('openai');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test cases
const testCases = [
  "how to cook a steak",
  "best productivity apps",
  "woodworking for beginners",
  "machine learning basics"
];

// Function to classify query type (from the actual code)
async function classifyQueryType(concept) {
  const lowerConcept = concept.toLowerCase();
  
  const type = 
    lowerConcept.includes('review') ? 'product_review' :
    lowerConcept.includes('vs') || lowerConcept.includes('versus') ? 'comparison' :
    lowerConcept.includes('how to') || lowerConcept.includes('tutorial') ? 'technique' :
    'general';
  
  // Check specificity by looking for brand/model names
  const specificity = 
    /[a-z]+\s+[a-z0-9]+\s+(ultra|pro|plus|v\d|mk\d)/i.test(concept) ? 'high' :
    /[a-z]+\s+[a-z0-9]+/i.test(concept) ? 'medium' :
    'low';
    
  const hasFormat = ['review', 'tutorial', 'comparison', 'guide', 'tips'].some(f => 
    lowerConcept.includes(f)
  );
  
  return { type, specificity, hasFormat };
}

// Test function for direct variations
async function testDirectVariations(concept) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "Generate 5-6 direct variations of the given concept. Return only a JSON array of strings."
      }, {
        role: "user",
        content: `Original concept: "${concept}"

Generate direct variations that explore the same specific topic from different angles:
- Common problems/issues with this topic
- Success/results related to this topic
- Time-based variations (after X months, in 2024, etc.)
- Direct comparisons or alternatives
- Specific features or aspects

Keep all queries closely related to the original concept.
Return format: ["query1", "query2", "query3", ...]`
      }],
      temperature: 0.7,
      max_tokens: 200
    });

    const content = response.choices[0].message.content || '[]';
    // Clean up the response in case GPT-4o-mini adds markdown formatting
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error('Error in direct expansion:', error);
    return [];
  }
}

// Test function for format variations
async function testFormatVariations(concept) {
  try {
    // Extract the core topic without format words
    const coreTopicMatch = concept.match(/^(.+?)\s*(review|tutorial|guide|comparison|tips|vs|versus|unboxing|test|setup)*$/i);
    const coreTopic = coreTopicMatch ? coreTopicMatch[1].trim() : concept;
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "Generate 5-6 queries that find the same topic in different content formats. Return only a JSON array of strings."
      }, {
        role: "user",
        content: `Core topic: "${coreTopic}"
Original query: "${concept}"

Generate queries that find this topic in DIFFERENT content formats:
- If it's a review, find tutorials and comparisons
- If it's a tutorial, find reviews and tips/tricks
- Include formats like: tutorial, review, comparison, unboxing, tips, guide, mistakes, setup
- Mix specific product names with format keywords

Available formats to explore: tutorial, explainer, listicle, case_study, product_focus, comparison, news_update

Return format: ["query1", "query2", "query3", ...]`
      }],
      temperature: 0.7,
      max_tokens: 200
    });

    const content = response.choices[0].message.content || '[]';
    // Clean up the response in case GPT-4o-mini adds markdown formatting
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error('Error in format expansion:', error);
    return [];
  }
}

// Test function for domain hierarchy
async function testDomainHierarchy(concept) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "Generate 5-6 queries that expand from specific to general categories. Return only a JSON array of strings."
      }, {
        role: "user",
        content: `Original concept: "${concept}"

Generate queries that explore the broader category hierarchy:
- If it's a specific product (e.g., "xtool F2"), expand to brand level ("xtool"), then category ("laser engraver"), then domain ("maker tools")
- If it's a specific technique, expand to general skill area
- Include industry-wide patterns and category trends
- Move from very specific to progressively broader terms

Think of it as zooming out from the specific concept to see the bigger picture.

Return format: ["query1", "query2", "query3", ...]`
      }],
      temperature: 0.7,
      max_tokens: 200
    });

    const content = response.choices[0].message.content || '[]';
    // Clean up the response in case GPT-4o-mini adds markdown formatting
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error('Error in domain expansion:', error);
    return [];
  }
}

// Main test runner
async function runTests() {
  console.log('Testing GPT-4o-mini Domain Detection and Query Expansion\n');
  console.log('=' * 60);
  
  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST CASE: "${testCase}"`);
    console.log(`${'='.repeat(60)}`);
    
    // Step 1: Classify query type
    const queryType = await classifyQueryType(testCase);
    console.log('\n1. Query Classification:');
    console.log(`   Type: ${queryType.type}`);
    console.log(`   Specificity: ${queryType.specificity}`);
    console.log(`   Has Format: ${queryType.hasFormat}`);
    
    // Step 2: Test direct variations (always runs)
    console.log('\n2. Direct Variations:');
    const directResults = await testDirectVariations(testCase);
    directResults.forEach((query, i) => {
      console.log(`   ${i + 1}. ${query}`);
    });
    
    // Step 3: Test format variations (conditional)
    if (queryType.hasFormat || queryType.type === 'product_review' || queryType.type === 'technique') {
      console.log('\n3. Format Variations:');
      const formatResults = await testFormatVariations(testCase);
      formatResults.forEach((query, i) => {
        console.log(`   ${i + 1}. ${query}`);
      });
    } else {
      console.log('\n3. Format Variations: SKIPPED (not applicable for this query type)');
    }
    
    // Step 4: Test domain hierarchy (conditional)
    if (queryType.specificity !== 'low') {
      console.log('\n4. Domain Hierarchy:');
      const domainResults = await testDomainHierarchy(testCase);
      domainResults.forEach((query, i) => {
        console.log(`   ${i + 1}. ${query}`);
      });
    } else {
      console.log('\n4. Domain Hierarchy: SKIPPED (low specificity query)');
    }
    
    console.log('\n' + '-'.repeat(60));
    console.log('ANALYSIS:');
    
    // Check if queries stay within domain
    const allQueries = [
      ...directResults,
      ...(queryType.hasFormat || queryType.type === 'product_review' || queryType.type === 'technique' ? await testFormatVariations(testCase) : []),
      ...(queryType.specificity !== 'low' ? await testDomainHierarchy(testCase) : [])
    ];
    
    // Simple domain detection based on keywords
    const domainKeywords = {
      cooking: ['cook', 'recipe', 'kitchen', 'food', 'chef', 'meal', 'dish', 'cuisine', 'grill', 'bake', 'fry'],
      tech: ['app', 'software', 'tech', 'digital', 'computer', 'tool', 'platform', 'system', 'productivity'],
      crafts: ['wood', 'craft', 'diy', 'build', 'make', 'tool', 'workshop', 'project', 'create'],
      education: ['learn', 'teach', 'basic', 'course', 'tutorial', 'guide', 'understand', 'master', 'study']
    };
    
    // Determine expected domain
    let expectedDomain = 'unknown';
    if (testCase.includes('cook') || testCase.includes('steak')) expectedDomain = 'cooking';
    else if (testCase.includes('app') || testCase.includes('productivity')) expectedDomain = 'tech';
    else if (testCase.includes('wood')) expectedDomain = 'crafts';
    else if (testCase.includes('machine learning') || testCase.includes('basics')) expectedDomain = 'education';
    
    // Check domain consistency
    let inDomainCount = 0;
    let outOfDomainQueries = [];
    
    allQueries.forEach(query => {
      const queryLower = query.toLowerCase();
      const isInDomain = domainKeywords[expectedDomain]?.some(keyword => queryLower.includes(keyword));
      
      if (isInDomain) {
        inDomainCount++;
      } else {
        // Check if it's in another domain
        let foundInOtherDomain = false;
        for (const [domain, keywords] of Object.entries(domainKeywords)) {
          if (domain !== expectedDomain && keywords.some(k => queryLower.includes(k))) {
            outOfDomainQueries.push({ query, domain });
            foundInOtherDomain = true;
            break;
          }
        }
        if (!foundInOtherDomain) {
          outOfDomainQueries.push({ query, domain: 'unclear' });
        }
      }
    });
    
    const domainConsistencyRate = (inDomainCount / allQueries.length * 100).toFixed(1);
    console.log(`Domain consistency: ${domainConsistencyRate}% (${inDomainCount}/${allQueries.length} queries stay in ${expectedDomain} domain)`);
    
    if (outOfDomainQueries.length > 0) {
      console.log('\nOut-of-domain queries:');
      outOfDomainQueries.forEach(({ query, domain }) => {
        console.log(`   - "${query}" (detected domain: ${domain})`);
      });
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('TEST COMPLETE');
  console.log(`${'='.repeat(60)}`);
}

// Run the tests
runTests().catch(console.error);