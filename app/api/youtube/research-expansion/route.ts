import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';

interface SearchStrategy {
  type: 'semantic' | 'format' | 'competitive';
  query: string;
  weight: number;
  format_filter?: string;
  performance_filter?: string;
  category_name?: string;
  category_emoji?: string;
}

interface ExpansionResult {
  expanded_terms: string[];
  search_strategies: SearchStrategy[];
  content_types: string[];
  research_angles: string[];
}

export async function POST(request: Request) {
  try {
    const { query } = await request.json();

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    console.log('🧠 Expanding research query:', query);

    const prompt = `You are a video content research assistant. Given a video topic/idea, generate intelligent search strategies to find related successful content.

User's video topic: "${query}"

Return a JSON response with:
1. expanded_terms: 5-7 related keywords/phrases for semantic search
2. search_strategies: 3-5 specific search approaches with different angles
3. content_types: relevant video formats to focus on
4. research_angles: different perspectives to explore

IMPORTANT: Use only these valid format_filter values when specified:
- tutorial
- explainer  
- case_study
- product_focus
- listicle
- personal_story
- news_analysis
- vlog
- live_stream
- update
- shorts
- compilation

Example for "iPhone 14 Review":
{
  "expanded_terms": ["iPhone 14", "smartphone review", "Apple product", "phone comparison", "tech review", "mobile device", "consumer electronics"],
  "search_strategies": [
    {"type": "semantic", "query": "iPhone 14 review", "weight": 1.0, "category_name": "iPhone 14 Reviews & Deep Dives", "category_emoji": "📱"},
    {"type": "format", "query": "smartphone product focus", "weight": 0.8, "format_filter": "product_focus", "category_name": "Product Focus Videos", "category_emoji": "📦"},
    {"type": "format", "query": "tech explainer videos", "weight": 0.7, "format_filter": "explainer", "category_name": "Tech Explainer Content", "category_emoji": "⚔️"},
    {"type": "semantic", "query": "Apple product review", "weight": 0.6, "category_name": "Apple Ecosystem Reviews", "category_emoji": "🍎"},
    {"type": "format", "query": "tech tutorial content", "weight": 0.5, "format_filter": "tutorial", "category_name": "Tutorial & How-To Videos", "category_emoji": "🔥"}
  ],
  "content_types": ["product_focus", "explainer", "tutorial", "case_study"],
  "research_angles": ["First impressions", "Detailed review", "Comparison vs competitors", "User experience", "Value proposition"]
}

Be creative and comprehensive. Think about:
- Direct topic matches
- Related categories  
- Different content formats
- Competitive analysis angles
- Performance patterns

IMPORTANT: For each search strategy, create engaging Netflix-style category names with emojis that describe what type of content will be found. Make them specific to the user's topic and appealing to browse.

Examples of good category names:
- "xTool F2 Ultra Reviews & Deep Dives" (emoji: 🔬)
- "Trending Laser Engraver Content" (emoji: 🔥)  
- "High-Performance Maker Tool Videos" (emoji: ⚡)
- "DIY Project Inspiration" (emoji: 💡)
- "Product Comparison Showdowns" (emoji: ⚔️)

CRITICAL: Return ONLY valid JSON. Do NOT put emojis outside of quoted strings. All emojis must be inside the "category_name" or "category_emoji" string values.

Return only valid JSON:`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a video content research assistant. Return only valid JSON responses.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 800
    });

    const response = completion.choices[0].message.content;
    
    try {
      const expansionResult: ExpansionResult = JSON.parse(response || '{}');
      
      console.log('✅ Query expansion completed:', {
        original_query: query,
        expanded_terms_count: expansionResult.expanded_terms?.length || 0,
        strategies_count: expansionResult.search_strategies?.length || 0
      });

      return NextResponse.json(expansionResult);
    } catch (parseError) {
      console.error('❌ Failed to parse LLM response:', parseError);
      console.log('Raw response:', response);
      
      // Fallback expansion
      const fallback: ExpansionResult = {
        expanded_terms: [query],
        search_strategies: [
          { type: 'semantic', query: query, weight: 1.0 }
        ],
        content_types: ['review', 'tutorial', 'product_focus'],
        research_angles: ['Direct search']
      };
      
      return NextResponse.json(fallback);
    }

  } catch (error) {
    console.error('❌ Research expansion error:', error);
    return NextResponse.json(
      { error: 'Failed to expand research query' },
      { status: 500 }
    );
  }
}