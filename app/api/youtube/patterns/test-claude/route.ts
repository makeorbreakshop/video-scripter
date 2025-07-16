import { NextResponse } from 'next/server';
import { LLMPatternInterpreter } from '@/lib/llm-pattern-interpreter';

export async function GET() {
  try {
    const interpreter = new LLMPatternInterpreter();
    
    // Test patterns - one generic, one meaningful
    const testPatterns = [
      {
        pattern_type: 'title' as const,
        pattern_data: {
          name: 'Contains "the"',
          template: '*the*',
          evidence_count: 50,
          confidence: 0.99,
          examples: ['The best recipe', 'Making the perfect cake', 'The ultimate guide']
        },
        performance_stats: { avg: 1.2, median: 1.1, count: 50 }
      },
      {
        pattern_type: 'title' as const,
        pattern_data: {
          name: 'Historical cooking with hashtags',
          template: '[Historical Topic] #history #cooking',
          evidence_count: 15,
          confidence: 0.85,
          examples: [
            'What is Ship\'s Biscuit? #history #navy #sailor #historicalcooking',
            'What Is Portable Soup?? #history #18thcenturycooking #cooking'
          ]
        },
        performance_stats: { avg: 20.5, median: 15.0, count: 15 }
      }
    ];

    console.log('Testing Claude pattern interpreter...');
    
    const interpreted = await interpreter.analyzePatterns(testPatterns, {
      videoContext: {
        topic: 'cooking',
        videoCount: 500,
        avgPerformance: 1.0
      }
    });

    return NextResponse.json({
      success: true,
      inputPatterns: testPatterns.length,
      outputPatterns: interpreted.length,
      patterns: interpreted
    });

  } catch (error) {
    console.error('Claude test error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}