const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Import our prompt templates (inline for .cjs compatibility)
const DOMAIN_DETECTION_PROMPT = (concept) => `Analyze this search concept and identify its domain context.
Concept: "${concept}"

Return a JSON object with:
{
  "primary_domain": "one of: cooking|technology|fitness|education|entertainment|diy|business|health|travel|other",
  "domain_keywords": ["5-8 keywords that are specific to this domain"],
  "avoid_domains": ["list domains that might have overlapping terms but should be avoided"],
  "disambiguation_terms": ["terms to add to queries to keep them in the right domain"]
}`;

const MULTI_THREAD_QUERY_EXPANSION_PROMPT = (concept, domainContext) => `Generate YouTube search queries for: "${concept}"

Domain Context:
- Primary domain: ${domainContext.primary_domain}
- Use these domain-specific terms: ${domainContext.domain_keywords.join(', ')}
- Avoid content from: ${domainContext.avoid_domains.join(', ')}

Create 3 sets of queries (6 queries each):

1. DIRECT VARIATIONS (Thread 1):
   - Stay very close to the original concept
   - Use exact terminology from the search
   - Add domain-specific qualifiers to ambiguous terms
   - Example: If user wants "tools", specify "${domainContext.domain_keywords[0]} tools"

2. FORMAT VARIATIONS (Thread 2):
   - Explore different content formats within ${domainContext.primary_domain}
   - Use format terms: tutorial, guide, review, comparison, tips
   - Keep all queries within the ${domainContext.primary_domain} domain

3. DOMAIN HIERARCHY (Thread 3):
   - Broaden to related concepts within ${domainContext.primary_domain}
   - Do NOT cross into ${domainContext.avoid_domains.join(' or ')}
   - Use broader ${domainContext.primary_domain} terminology

For each query:
- Include at least one ${domainContext.primary_domain} keyword
- Make queries that would find videos from ${domainContext.primary_domain} channels
- Avoid ambiguous terms that could match ${domainContext.avoid_domains.join(' or ')} content

Return as JSON with structure:
{
  "direct_variations": ["query1", "query2", ...],
  "format_variations": ["query1", "query2", ...],
  "domain_hierarchy": ["query1", "query2", ...]
}`;

async function testImprovedExpansion() {
  const concept = "how to cook a steak";
  
  console.log(`Testing improved expansion for: "${concept}"\n`);

  // Step 1: Detect domain
  console.log("=== STEP 1: Domain Detection ===");
  const domainResult = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: DOMAIN_DETECTION_PROMPT(concept) }],
    temperature: 0.3,
    response_format: { type: "json_object" }
  });
  
  const domainContext = JSON.parse(domainResult.choices[0].message.content);
  console.log("Domain context:", JSON.stringify(domainContext, null, 2));

  // Step 2: Generate queries with domain awareness
  console.log("\n=== STEP 2: Domain-Aware Query Expansion ===");
  const expansionResult = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: MULTI_THREAD_QUERY_EXPANSION_PROMPT(concept, domainContext) }],
    temperature: 0.7,
    response_format: { type: "json_object" }
  });
  
  const expandedQueries = JSON.parse(expansionResult.choices[0].message.content);
  console.log("\nExpanded queries:");
  console.log("Direct Variations:", expandedQueries.direct_variations);
  console.log("\nFormat Variations:", expandedQueries.format_variations);
  console.log("\nDomain Hierarchy:", expandedQueries.domain_hierarchy);

  // Step 3: Check if problematic queries are fixed
  console.log("\n=== ANALYSIS: Checking for Problematic Patterns ===");
  const allQueries = [
    ...expandedQueries.direct_variations,
    ...expandedQueries.format_variations,
    ...expandedQueries.domain_hierarchy
  ];

  const problematicTerms = ['tools', 'equipment', 'gear'];
  const ambiguousQueries = allQueries.filter(q => 
    problematicTerms.some(term => q.toLowerCase().includes(term))
  );

  if (ambiguousQueries.length > 0) {
    console.log("\nFound potentially ambiguous queries:");
    ambiguousQueries.forEach(q => {
      const hasDomainKeyword = domainContext.domain_keywords.some(kw => 
        q.toLowerCase().includes(kw.toLowerCase())
      );
      console.log(`- "${q}" ${hasDomainKeyword ? '✓ (has domain keyword)' : '✗ (might be ambiguous)'}`);
    });
  } else {
    console.log("\n✓ No ambiguous queries found!");
  }

  // Step 4: Test with other concepts
  console.log("\n=== TESTING OTHER CONCEPTS ===");
  const testConcepts = [
    "python programming basics",
    "woodworking for beginners",
    "yoga stretches"
  ];

  for (const testConcept of testConcepts) {
    console.log(`\nTesting: "${testConcept}"`);
    
    const testDomainResult = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: DOMAIN_DETECTION_PROMPT(testConcept) }],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });
    
    const testDomain = JSON.parse(testDomainResult.choices[0].message.content);
    console.log(`- Domain: ${testDomain.primary_domain}`);
    console.log(`- Keywords: ${testDomain.domain_keywords.slice(0, 3).join(', ')}...`);
    console.log(`- Avoid: ${testDomain.avoid_domains.join(', ')}`);
  }
}

testImprovedExpansion().catch(console.error);