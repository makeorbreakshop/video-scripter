// Improved query expansion prompts that maintain domain relevance

export const DOMAIN_DETECTION_PROMPT = (concept) => `Analyze this search concept and identify its domain context.
Concept: "${concept}"

Return a JSON object with:
{
  "primary_domain": "one of: cooking|technology|fitness|education|entertainment|diy|business|health|travel|other",
  "domain_keywords": ["5-8 keywords that are specific to this domain"],
  "avoid_domains": ["list domains that might have overlapping terms but should be avoided"],
  "disambiguation_terms": ["terms to add to queries to keep them in the right domain"]
}

Examples:
- For "how to cook steak": primary_domain: "cooking", domain_keywords: ["kitchen", "chef", "recipe", "food", "grill"], avoid_domains: ["metalworking", "construction"]
- For "python basics": primary_domain: "technology", domain_keywords: ["programming", "code", "software", "tutorial"], avoid_domains: ["zoology", "pets"]`;

export const MULTI_THREAD_QUERY_EXPANSION_PROMPT = (concept, domainContext) => `Generate YouTube search queries for: "${concept}"

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

export const COHERENCE_CHECK_PROMPT = (concept, videoTitles) => `A user searched for "${concept}" and got these video titles:
${videoTitles.map((title, i) => `${i + 1}. "${title}"`).join('\n')}

Analyze the search results:

1. Identify which videos are relevant to the search intent
2. Identify which videos are off-topic
3. Look for patterns that indicate off-topic content
4. Calculate a coherence score (0-1) for how well the results match the search intent

Consider:
- Does the video title relate to "${concept}"?
- Are there videos from unrelated domains (e.g., metalworking when searching for cooking)?
- Do the videos form a coherent set that a user searching for "${concept}" would want?

Return as JSON:
{
  "relevant_videos": [list of video numbers],
  "off_topic_videos": [list of video numbers],
  "off_topic_patterns": ["patterns that indicate off-topic content"],
  "coherence_score": 0.0-1.0,
  "recommendation": "accept|filter|retry with higher threshold"
}`;

export const QUERY_DISAMBIGUATION_PROMPT = (query, domainContext) => `The query "${query}" might be ambiguous and could match content from multiple domains.

Target domain: ${domainContext.primary_domain}
Domain keywords: ${domainContext.domain_keywords.join(', ')}
Avoid domains: ${domainContext.avoid_domains.join(', ')}

Rewrite this query to be unambiguous and ensure it finds content specifically from ${domainContext.primary_domain} domain.

Examples:
- "essential tools" → "essential kitchen tools" (for cooking domain)
- "cutting techniques" → "knife cutting techniques cooking" (for cooking domain)
- "temperature control" → "cooking temperature control" (for cooking domain)

Return only the improved query, no explanation.`;