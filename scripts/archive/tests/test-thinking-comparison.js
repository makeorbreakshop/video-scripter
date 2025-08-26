#!/usr/bin/env node

/**
 * Extended Thinking A/B Test - Step 1 Pattern Extraction Quality Analysis
 * 
 * Tests three configurations:
 * 1. Control (No Thinking) - Current approach
 * 2. Moderate Thinking (4k tokens) - Balanced cost/quality 
 * 3. Deep Thinking (8k tokens) - Maximum reasoning depth
 */

async function runThinkingTest() {
  console.log('🧪 Extended Thinking A/B Test for Pattern Extraction');
  console.log('===================================================\n');

  const testVideo = 'XKrDUnZCmQQ'; // Perfect Tolerance video (17.7x TPS)
  
  try {
    console.log(`📺 Testing video: ${testVideo}`);
    console.log('🔬 Running all three thinking configurations...\n');

    const response = await fetch('http://localhost:3000/api/analyze-pattern-thinking-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_id: testVideo
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const results = await response.json();
    
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('========================\n');
    
    console.log(`🎯 Target Video: "${results.target_video.title}"`);
    console.log(`📈 Performance: ${results.target_video.performance_score.toFixed(1)}x TPS (${results.target_video.views.toLocaleString()} views)`);
    console.log(`📚 Baseline Context: ${results.baseline_videos_count} channel videos\n`);

    // Cost Analysis
    console.log('💰 COST ANALYSIS');
    console.log('================');
    results.test_summary.cost_analysis.forEach(test => {
      console.log(`${test.test}: $${test.cost.toFixed(6)} (${test.vs_control})`);
    });
    console.log(`Total Cost: $${results.test_summary.total_cost.toFixed(6)}\n`);

    // Performance Analysis
    console.log('⏱️ PERFORMANCE ANALYSIS');
    console.log('=======================');
    results.test_results.forEach(test => {
      if (!test.error) {
        console.log(`${test.test_name}:`);
        console.log(`  Time: ${test.performance.execution_time_ms}ms`);
        console.log(`  Input tokens: ${test.performance.tokens.input_tokens}`);
        console.log(`  Output tokens: ${test.performance.tokens.output_tokens}`);
        if (test.performance.tokens.thinking_tokens) {
          console.log(`  Thinking tokens: ${test.performance.tokens.thinking_tokens}`);
        }
        console.log(`  Cost difference: ${test.cost_vs_expected.difference_pct}% vs expected\n`);
      }
    });

    // Quality Analysis - Pattern Names
    console.log('🎯 PATTERN QUALITY COMPARISON');
    console.log('=============================');
    results.test_results.forEach(test => {
      if (!test.error && test.analysis?.step_4_pattern_formulation) {
        console.log(`\n${test.test_name}:`);
        console.log(`  Pattern Name: "${test.analysis.step_4_pattern_formulation.pattern_name}"`);
        console.log(`  Description: ${test.analysis.step_4_pattern_formulation.pattern_description}`);
        console.log(`  Confidence: ${test.analysis.confidence_level}`);
        
        if (test.analysis.step_3_psychological_mechanism) {
          console.log(`  Psychology: ${test.analysis.step_3_psychological_mechanism.substring(0, 100)}...`);
        }
        
        if (test.analysis.step_4_pattern_formulation.success_factors) {
          console.log(`  Success Factors: ${test.analysis.step_4_pattern_formulation.success_factors.length} identified`);
        }
      }
    });

    // Visual Analysis Depth
    console.log('\n🎨 VISUAL ANALYSIS DEPTH');
    console.log('========================');
    results.test_results.forEach(test => {
      if (!test.error && test.analysis?.step_1_visual_inventory) {
        console.log(`\n${test.test_name}:`);
        const inventory = test.analysis.step_1_visual_inventory;
        console.log(`  Colors: ${inventory.colors?.length || 0} chars`);
        console.log(`  Typography: ${inventory.typography?.length || 0} chars`);
        console.log(`  Composition: ${inventory.composition?.length || 0} chars`);
        console.log(`  Focal Points: ${inventory.focal_points?.length || 0} chars`);
        
        const totalDetail = (inventory.colors?.length || 0) + 
                           (inventory.typography?.length || 0) + 
                           (inventory.composition?.length || 0) + 
                           (inventory.focal_points?.length || 0);
        console.log(`  Total Detail: ${totalDetail} characters`);
      }
    });

    // Thinking Content Analysis (if available)
    console.log('\n🧠 THINKING PROCESS VISIBILITY');
    console.log('==============================');
    results.test_results.forEach(test => {
      if (test.thinking_content) {
        console.log(`\n${test.test_name}:`);
        console.log(`  Thinking content length: ${test.thinking_content.length} characters`);
        console.log(`  First 200 chars: "${test.thinking_content.substring(0, 200)}..."`);
      } else {
        console.log(`\n${test.test_name}: No thinking content captured`);
      }
    });

    // Key Insights Summary
    console.log('\n🔍 KEY INSIGHTS & RECOMMENDATIONS');
    console.log('=================================');
    
    const controlCost = results.test_results[0]?.performance?.cost?.total || 0;
    const moderateCost = results.test_results[1]?.performance?.cost?.total || 0;
    const deepCost = results.test_results[2]?.performance?.cost?.total || 0;
    
    console.log(`\n1. Cost Impact:`);
    console.log(`   - Moderate thinking: +${((moderateCost/controlCost - 1) * 100).toFixed(0)}% cost increase`);
    console.log(`   - Deep thinking: +${((deepCost/controlCost - 1) * 100).toFixed(0)}% cost increase`);
    
    console.log(`\n2. Quality Assessment:`);
    console.log(`   - Review pattern names and descriptions above for specificity`);
    console.log(`   - Compare visual analysis detail levels`);
    console.log(`   - Evaluate psychological mechanism depth`);
    
    console.log(`\n3. Next Steps:`);
    console.log(`   - Analyze if thinking reveals insights missed by control`);
    console.log(`   - Determine if cost increase justifies quality improvement`);
    console.log(`   - Consider testing on additional videos for consistency`);

    // Save results for detailed analysis
    const { writeFileSync } = await import('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `thinking-test-results-${timestamp}.json`;
    
    writeFileSync(filename, JSON.stringify(results, null, 2));
    console.log(`\n💾 Detailed results saved to: ${filename}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
runThinkingTest();