/**
 * Test script to debug the repair function for pattern reports
 */

import { repairPatternReport, FinalPatternReportSchema } from '../lib/agentic/schemas/pattern-report';
import { z } from 'zod';

// Test case 1: Minimal data from OpenAI
const minimalData = {
  videoId: 'test123',
  primaryPattern: {
    statement: 'Test pattern',
    confidence: 0.8
  },
  secondaryPatterns: [
    { statement: 'Secondary 1' },
    { statement: 'Secondary 2' }
  ]
};

console.log('Testing minimal data repair...\n');
try {
  const repaired = repairPatternReport(minimalData);
  console.log('✅ Repair succeeded');
  
  // Validate with schema
  const validation = FinalPatternReportSchema.safeParse(repaired);
  if (validation.success) {
    console.log('✅ Schema validation passed');
    console.log('\nPrimary pattern evidence count:', repaired.primaryPattern.evidence.length);
    console.log('First evidence item:', JSON.stringify(repaired.primaryPattern.evidence[0], null, 2));
  } else {
    console.log('❌ Schema validation failed');
    console.log('Errors:', validation.error.errors.slice(0, 5));
  }
} catch (error) {
  console.error('❌ Repair failed:', error);
}

// Test case 2: Data with some fields but missing nested structures
const partialData = {
  videoId: 'test456',
  primaryPattern: {
    statement: 'Pattern with evidence',
    confidence: 0.9,
    evidence: [
      { title: 'Video 1' },
      { title: 'Video 2' },
      { title: 'Video 3' }
    ]
  },
  metadata: {
    totalVideosAnalyzed: 50
  },
  confidence: 0.75 // Number instead of object
};

console.log('\n\nTesting partial data repair...\n');
try {
  const repaired = repairPatternReport(partialData);
  console.log('✅ Repair succeeded');
  
  // Validate with schema
  const validation = FinalPatternReportSchema.safeParse(repaired);
  if (validation.success) {
    console.log('✅ Schema validation passed');
    console.log('\nEvidence items have all fields:', 
      repaired.primaryPattern.evidence.every(e => 
        e.videoId && e.title && typeof e.tps === 'number' && e.channelName && typeof e.relevance === 'number'
      )
    );
  } else {
    console.log('❌ Schema validation failed');
    console.log('First 10 errors:', validation.error.errors.slice(0, 10).map(e => ({
      path: e.path.join('.'),
      message: e.message
    })));
  }
} catch (error) {
  console.error('❌ Repair failed:', error);
}

// Test case 3: Completely empty object
console.log('\n\nTesting empty object repair...\n');
try {
  const repaired = repairPatternReport({});
  console.log('✅ Repair succeeded');
  
  // Validate with schema
  const validation = FinalPatternReportSchema.safeParse(repaired);
  if (validation.success) {
    console.log('✅ Schema validation passed');
  } else {
    console.log('❌ Schema validation failed');
    console.log('First 5 errors:', validation.error.errors.slice(0, 5).map(e => ({
      path: e.path.join('.'),
      message: e.message
    })));
  }
} catch (error) {
  console.error('❌ Repair failed:', error);
}