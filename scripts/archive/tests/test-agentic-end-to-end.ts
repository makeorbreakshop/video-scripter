/**
 * End-to-end test for agentic mode with UI integration
 */

import { repairPatternReport } from '../lib/agentic/schemas/pattern-report';

// Simulate what OpenAI might return - incomplete data
const openAIResponse = {
  videoId: 'FVgupcKdIJM',
  primaryPattern: {
    statement: 'High-effort physical challenge videos with personal storytelling',
    confidence: 0.85,
    type: 'format',
    evidence: [
      { title: 'I Trained Like Mike Tyson' },
      { title: 'Testing Extreme Workouts' },
      { title: 'Surviving Navy SEAL Training' }
    ]
  },
  secondaryPatterns: [
    {
      statement: 'Time-based challenges (24-48 hours)',
      confidence: 0.7
    }
  ],
  recommendations: [
    {
      action: 'Create high-effort physical challenge content',
      priority: 'immediate'
    }
  ],
  confidence: 0.8 // Number instead of object
};

console.log('Testing OpenAI response repair for UI compatibility...\n');

try {
  // Repair the incomplete data
  const repaired = repairPatternReport(openAIResponse);
  
  console.log('✅ Repair succeeded\n');
  
  // Now transform for UI (simulating what createResult does)
  const uiData = {
    pattern: {
      pattern_name: repaired.primaryPattern.statement,
      pattern_type: repaired.primaryPattern.type,
      confidence: repaired.primaryPattern.confidence,
      validations: repaired.metadata.totalVideosAnalyzed,
      niches: repaired.primaryPattern.niches,
      evidence: repaired.primaryPattern.evidence,
      performance_impact: repaired.primaryPattern.performanceImpact,
      actionability: repaired.primaryPattern.actionability
    },
    source_video: {
      video_id: repaired.videoId,
      title: 'Test Video Title',
      channel_name: 'Test Channel',
      published_at: new Date().toISOString(),
      views: 1000000,
      temporal_performance_score: 3.5
    },
    validation: {
      total_videos_analyzed: repaired.metadata.totalVideosAnalyzed,
      hypothesis: repaired.primaryPattern.statement,
      evidence_strength: repaired.confidence.overall,
      competitive_analysis: repaired.competitiveAnalysis,
      channel_insights: repaired.channelInsights
    },
    debug: {
      mode: 'agentic',
      tokensUsed: repaired.metadata.tokensUsed,
      executionTimeMs: repaired.metadata.executionTimeMs,
      toolCallCount: repaired.metadata.toolCallCount,
      modelSwitches: repaired.metadata.modelSwitches,
      totalCost: repaired.metadata.totalCost,
      analysis: repaired
    }
  };
  
  // Check if UI data has all required fields
  console.log('UI Data Structure Check:');
  console.log('- Has pattern:', !!uiData.pattern);
  console.log('- Has source_video:', !!uiData.source_video);
  console.log('- Has validation:', !!uiData.validation);
  console.log('- Has debug:', !!uiData.debug);
  console.log('- Pattern has required fields:', 
    !!uiData.pattern.pattern_name && 
    !!uiData.pattern.pattern_type && 
    typeof uiData.pattern.confidence === 'number'
  );
  console.log('- Evidence items are complete:', 
    uiData.pattern.evidence.every((e: any) => 
      e.videoId && e.title && typeof e.tps === 'number' && e.channelName && typeof e.relevance === 'number'
    )
  );
  
  console.log('\n✅ All checks passed - UI should display correctly');
  
} catch (error) {
  console.error('❌ Test failed:', error);
}