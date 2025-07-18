# GPT-4o-mini Domain Detection Test Results

## Overview
We tested GPT-4o-mini's ability to generate domain-relevant query expansions for various search concepts. The model uses three expansion strategies:
1. **Direct Variations** - Always runs, explores the same topic from different angles
2. **Format Variations** - Runs for certain query types, explores different content formats
3. **Domain Hierarchy** - Runs for specific queries, expands from specific to general

## Test Results

### 1. "how to cook a steak" (Cooking Domain)
- **Domain Consistency**: 83.3% (15/18 queries stayed in cooking domain)
- **Query Classification**: technique, medium specificity, no format
- **Threads Run**: All 3 (Direct, Format, Domain)
- **Out-of-domain queries**: 
  - "how to achieve the perfect steak every time" (unclear domain)
  - "culinary techniques for preparing proteins" (detected as tech)
  - "overview of modern culinary arts" (unclear)

**Analysis**: Good performance overall. The model stayed within the cooking domain for most queries. The format variations appropriately added cooking-specific formats like "tutorial", "comparison", and "guide".

### 2. "best productivity apps" (Tech/Software Domain)
- **Domain Consistency**: 100% (12/12 queries stayed in tech domain)
- **Query Classification**: general, medium specificity, no format
- **Threads Run**: 2 (Direct, Domain) - Format skipped as expected
- **Out-of-domain queries**: None

**Analysis**: Perfect performance. All queries remained focused on productivity software, apps, and tech solutions. The domain hierarchy appropriately expanded from specific apps to broader productivity trends.

### 3. "woodworking for beginners" (Crafts/DIY Domain)
- **Domain Consistency**: 100% (12/12 queries stayed in crafts domain)
- **Query Classification**: general, medium specificity, no format
- **Threads Run**: 2 (Direct, Domain) - Format skipped as expected
- **Out-of-domain queries**: None

**Analysis**: Excellent performance. All queries remained within woodworking, tools, and crafts. The expansions covered appropriate aspects like tools, techniques, and industry trends.

### 4. "machine learning basics" (Tech/Education Domain)
- **Domain Consistency**: 83.3% (10/12 queries stayed in education domain)
- **Query Classification**: general, medium specificity, no format
- **Threads Run**: 2 (Direct, Domain) - Format skipped as expected
- **Out-of-domain queries**:
  - "artificial intelligence applications in various industries" (tech)
  - "data science tools and technologies" (tech)

**Analysis**: Good performance with minor domain drift. The model appropriately expanded to related AI and data science concepts, though these were classified as "tech" rather than "education".

## Key Findings

### Strengths:
1. **Excellent domain retention** - Average 91.6% domain consistency across all tests
2. **Smart thread selection** - Format variations only run when appropriate (e.g., for "how to" queries)
3. **Meaningful expansions** - Queries explore different aspects while staying relevant
4. **Appropriate hierarchy** - Domain expansion moves logically from specific to general

### Areas for Improvement:
1. **Ambiguous queries** - Some queries like "achieving the perfect steak" are hard to classify
2. **Domain boundaries** - Tech vs. Education overlap for technical learning topics
3. **Generic terms** - Queries with words like "overview" or "trends" sometimes lose domain specificity

### Recommendations:
1. The current prompts work well for domain detection and query expansion
2. Consider adding more specific domain keywords to improve classification accuracy
3. The multi-threaded approach effectively explores different aspects of queries
4. GPT-4o-mini is cost-effective for this use case ($0.15 per 1M input tokens)

## Conclusion
GPT-4o-mini performs well for domain-aware query expansion with the current prompts. The multi-threaded approach successfully generates relevant variations while maintaining domain consistency in most cases. The model is suitable for production use in the semantic title generation system.