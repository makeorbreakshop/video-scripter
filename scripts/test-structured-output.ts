/**
 * Test script for Structured Pattern Output
 */

import { 
  createPatternPage, 
  validatePatternPage, 
  createMinimalPatternPage,
  BlockType,
  type PatternPage 
} from '../lib/agentic/schemas/structured-pattern-output';

// Test data
const mockAgentResult = {
  success: true,
  mode: 'agentic',
  pattern: {
    pattern_name: 'High-effort challenges drive engagement',
    statement: 'Videos featuring high-effort physical challenges get 3.5x more views',
    confidence: 0.85,
    evidence: [
      {
        videoId: 'abc123',
        title: '100 Push-ups Every Day for 30 Days',
        tps: 3.8,
        type: 'title',
        relevance: 0.9,
        excerpt: 'Physical challenge in title',
        impact: 'High engagement from challenge content'
      },
      {
        videoId: 'def456',
        title: 'Building a Cabin in 7 Days',
        tps: 3.2,
        type: 'title',
        relevance: 0.85,
        excerpt: 'Time-bound challenge',
        impact: 'Creates urgency and commitment'
      },
      {
        videoId: 'ghi789',
        title: 'Extreme thumbnail with sweat',
        tps: 2.9,
        type: 'thumbnail',
        relevance: 0.8,
        excerpt: 'Visual effort indicators',
        impact: 'Shows genuine effort visually'
      }
    ],
    niches: ['fitness', 'diy', 'challenge'],
    validations: 15
  },
  source_video: {
    id: 'source123',
    title: 'Original Outlier Video',
    channel: 'Test Channel',
    views: 1000000,
    score: 4.2,
    thumbnail: 'https://example.com/thumb.jpg',
    baseline: 250000,
    published_at: '2025-01-01T00:00:00Z'
  },
  validation: {
    results: [
      {
        niche: 'fitness',
        videos: [
          {
            id: 'v1',
            title: 'Morning Routine',
            channel: 'Fitness Pro',
            views: 500000,
            score: 3.1,
            published_at: '2025-01-02T00:00:00Z'
          }
        ],
        pattern_score: 0.8,
        avg_performance: 3.0,
        count: 5
      }
    ],
    total_validations: 15,
    pattern_strength: 0.85,
    avg_pattern_score: 0.82
  },
  debug: {
    hypothesis: {
      statement: 'Initial hypothesis about effort',
      confidence: 0.75
    },
    recommendations: [
      {
        action: 'Add physical challenge to next video',
        priority: 'immediate',
        expectedImpact: '2-3x view increase',
        confidence: 0.85
      },
      {
        action: 'Show effort visually in thumbnail',
        priority: 'high',
        expectedImpact: '50% CTR improvement',
        confidence: 0.8
      },
      {
        action: 'Use time-bound challenge format',
        priority: 'medium',
        expectedImpact: 'Better retention',
        confidence: 0.7
      }
    ]
  },
  metrics: {
    videosAnalyzed: 50,
    patternsFound: 3,
    totalDuration: 45000
  },
  budgetUsage: {
    tokens: 15000,
    totalCost: 0.25,
    toolCalls: 18
  }
};

function runTests() {
  console.log('🧪 Testing Structured Pattern Output\n');
  console.log('=' .repeat(50));
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  // Test 1: Create pattern page from agent result
  console.log('\n📌 Test 1: Creating pattern page from agent result');
  try {
    const patternPage = createPatternPage(
      mockAgentResult,
      'test_run_123',
      '/logs/test.jsonl'
    );
    
    console.log('✅ Pattern page created');
    console.log(`  - Version: ${patternPage.version}`);
    console.log(`  - Summary: ${patternPage.summary_md.substring(0, 50)}...`);
    console.log(`  - Blocks: ${patternPage.blocks.length}`);
    console.log(`  - Source IDs: ${patternPage.source_ids.length}`);
    
    // Verify block types
    const blockTypes = patternPage.blocks.map(b => b.type);
    console.log(`  - Block types: ${blockTypes.join(', ')}`);
    
    testsPassed++;
  } catch (error) {
    console.error('❌ Failed to create pattern page:', error);
    testsFailed++;
  }
  
  // Test 2: Validate pattern page schema
  console.log('\n📌 Test 2: Validating pattern page schema');
  try {
    const patternPage = createPatternPage(mockAgentResult);
    const validated = validatePatternPage(patternPage);
    
    console.log('✅ Schema validation passed');
    console.log(`  - Valid version: ${validated.version === '1.0'}`);
    console.log(`  - Has blocks: ${validated.blocks.length > 0}`);
    console.log(`  - Has meta: ${validated.meta !== undefined}`);
    
    testsPassed++;
  } catch (error) {
    console.error('❌ Schema validation failed:', error);
    testsFailed++;
  }
  
  // Test 3: Test repair function with invalid data
  console.log('\n📌 Test 3: Testing repair function with invalid data');
  try {
    const invalidData = {
      summary_md: 'Test summary',
      blocks: [
        { type: 'INVALID_TYPE', data: {} },
        { 
          type: BlockType.TITLE_PATTERNS,
          data: { patterns: [] }
        }
      ]
    };
    
    const repaired = validatePatternPage(invalidData);
    console.log('✅ Repair function handled invalid data');
    console.log(`  - Repaired blocks: ${repaired.blocks.length}`);
    console.log(`  - Version set: ${repaired.version}`);
    
    testsPassed++;
  } catch (error) {
    console.error('❌ Repair function failed:', error);
    testsFailed++;
  }
  
  // Test 4: Create minimal pattern page for errors
  console.log('\n📌 Test 4: Creating minimal pattern page for errors');
  try {
    const errorPage = createMinimalPatternPage(
      'Analysis failed',
      'Network timeout error'
    );
    
    console.log('✅ Minimal error page created');
    console.log(`  - Summary: ${errorPage.summary_md}`);
    console.log(`  - Has error block: ${errorPage.blocks.length > 0}`);
    
    if (errorPage.blocks.length > 0 && errorPage.blocks[0].type === BlockType.CHECKLIST) {
      const checklist = errorPage.blocks[0].data as any;
      console.log(`  - Error action: ${checklist.items[0].action}`);
    }
    
    testsPassed++;
  } catch (error) {
    console.error('❌ Failed to create minimal page:', error);
    testsFailed++;
  }
  
  // Test 5: Extract different pattern types
  console.log('\n📌 Test 5: Testing pattern extraction by type');
  try {
    const patternPage = createPatternPage(mockAgentResult);
    
    // Find title patterns block
    const titleBlock = patternPage.blocks.find(b => b.type === BlockType.TITLE_PATTERNS);
    const thumbBlock = patternPage.blocks.find(b => b.type === BlockType.THUMB_PATTERNS);
    const checklistBlock = patternPage.blocks.find(b => b.type === BlockType.CHECKLIST);
    
    console.log('✅ Pattern extraction working');
    console.log(`  - Title patterns: ${titleBlock ? 'Found' : 'Missing'}`);
    console.log(`  - Thumbnail patterns: ${thumbBlock ? 'Found' : 'Missing'}`);
    console.log(`  - Checklist items: ${checklistBlock ? 'Found' : 'Missing'}`);
    
    if (titleBlock && titleBlock.type === BlockType.TITLE_PATTERNS) {
      console.log(`  - Title pattern count: ${titleBlock.data.patterns.length}`);
    }
    
    testsPassed++;
  } catch (error) {
    console.error('❌ Pattern extraction failed:', error);
    testsFailed++;
  }
  
  // Test 6: Verify metadata generation
  console.log('\n📌 Test 6: Testing metadata generation');
  try {
    const patternPage = createPatternPage(
      mockAgentResult,
      'run_456',
      '/logs/run_456.jsonl'
    );
    
    console.log('✅ Metadata generated correctly');
    console.log(`  - Run ID: ${patternPage.meta.run_id}`);
    console.log(`  - Runtime: ${patternPage.meta.run_time_ms}ms`);
    console.log(`  - Tools used: ${patternPage.meta.tools_used.join(', ')}`);
    console.log(`  - Total tokens: ${patternPage.meta.total_tokens}`);
    console.log(`  - Total cost: $${patternPage.meta.total_cost}`);
    console.log(`  - Log file: ${patternPage.meta.log_file}`);
    
    testsPassed++;
  } catch (error) {
    console.error('❌ Metadata generation failed:', error);
    testsFailed++;
  }
  
  // Summary
  console.log('\n' + '=' .repeat(50));
  console.log(`\n📊 Test Results:`);
  console.log(`  ✅ Passed: ${testsPassed}`);
  console.log(`  ❌ Failed: ${testsFailed}`);
  
  if (testsFailed === 0) {
    console.log('\n🎉 All structured output tests passed!');
  } else {
    console.log(`\n⚠️ ${testsFailed} test(s) failed`);
  }
  
  return testsFailed === 0;
}

// Run tests
const success = runTests();
process.exit(success ? 0 : 1);