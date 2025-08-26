/**
 * Test script for enhanced pattern analysis with thumbnail support
 */

async function testEnhancedPattern() {
  console.log('🧪 Testing Enhanced Pattern Analysis...\n');
  
  // Test with Rick Beato video that performed well
  const testVideoId = 'eKxNGFjyRv0'; // "I'm Sorry...This New Artist Completely Sucks"
  
  console.log(`📺 Testing with video: ${testVideoId}`);
  console.log(`🔗 Expected to be Rick Beato critique video\n`);
  
  try {
    const startTime = Date.now();
    
    const response = await fetch('http://localhost:3000/api/analyze-pattern-enhanced', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_id: testVideoId
      })
    });
    
    const endTime = Date.now();
    console.log(`⏱️ API call completed in ${endTime - startTime}ms\n`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    
    // Analyze results
    console.log('🎯 ENHANCED PATTERN ANALYSIS RESULTS');
    console.log('=====================================\n');
    
    console.log('📝 EXTRACTED PATTERN:');
    console.log(`Name: ${result.pattern.pattern_name}`);
    console.log(`Description: ${result.pattern.pattern_description}`);
    console.log(`Psychology: ${result.pattern.psychological_trigger}`);
    console.log(`Text Elements: ${result.pattern.key_elements?.join(', ')}`);
    console.log(`Visual Elements: ${result.pattern.visual_elements?.join(', ') || 'None'}`);
    console.log(`Thumbnail Psychology: ${result.pattern.thumbnail_psychology || 'Not analyzed'}`);
    console.log(`Why It Works: ${result.pattern.why_it_works}\n`);
    
    console.log('🔍 SEARCH QUERIES GENERATED:');
    console.log(`Text Queries: ${result.pattern.semantic_queries?.join(', ')}`);
    console.log(`Visual Queries: ${result.pattern.visual_queries?.join(', ') || 'None'}\n`);
    
    console.log('📊 SOURCE VIDEO:');
    console.log(`Title: "${result.source_video.title}"`);
    console.log(`Channel: ${result.source_video.channel}`);
    console.log(`Performance: ${result.source_video.score?.toFixed(1)}x TPS`);
    console.log(`Views: ${result.source_video.views?.toLocaleString()}`);
    console.log(`Thumbnail: ${result.source_video.thumbnail ? '✅ Available' : '❌ Missing'}\n`);
    
    console.log('🔎 SEARCH DEBUG INFO:');
    console.log(`Total Searches: ${result.debug.total_searches}`);
    console.log(`Text Searches: ${result.debug.text_searches}`);
    console.log(`Visual Searches: ${result.debug.visual_searches}`);
    console.log(`Unique Videos Found: ${result.debug.unique_videos_found}`);
    console.log(`Thumbnail Analysis: ${result.debug.thumbnail_analysis_enabled ? '✅ Enabled' : '❌ Disabled'}\n`);
    
    console.log('✅ VALIDATION RESULTS:');
    console.log(`Total Validations: ${result.validation.total_validations}`);
    console.log(`Visual Validations: ${result.validation.visual_validations}`);
    console.log(`Pattern Strength: ${result.validation.pattern_strength}`);
    console.log(`Avg Pattern Score: ${result.validation.avg_pattern_score?.toFixed(1)}x\n`);
    
    if (result.validation.results && result.validation.results.length > 0) {
      console.log('🌐 CROSS-NICHE VALIDATION:');
      result.validation.results.forEach((niche, i) => {
        console.log(`\n${i + 1}. ${niche.niche} (${niche.count} videos, avg ${niche.avg_score.toFixed(1)}x):`);
        niche.videos.forEach((video, j) => {
          console.log(`   ${j + 1}. "${video.title}"`);
          console.log(`      Channel: ${video.channel} | Score: ${video.score.toFixed(1)}x | Source: ${video.source}`);
          console.log(`      Text Match: ${video.validation_reason}`);
          if (video.visual_match) {
            console.log(`      Visual Match: ${video.visual_match}`);
          }
        });
      });
    } else {
      console.log('⚠️ No validation results found');
    }
    
    console.log(`\n⏱️ Total Processing Time: ${result.processing_time_ms}ms`);
    
    // Summary assessment
    console.log('\n🎯 ENHANCEMENT ASSESSMENT:');
    console.log('=========================');
    
    const hasVisualElements = result.pattern.visual_elements && result.pattern.visual_elements.length > 0;
    const hasVisualQueries = result.pattern.visual_queries && result.pattern.visual_queries.length > 0;
    const hasVisualValidations = result.validation.visual_validations > 0;
    const hasThumbnailPsychology = !!result.pattern.thumbnail_psychology;
    
    console.log(`✅ Visual Elements Extracted: ${hasVisualElements ? 'YES' : 'NO'}`);
    console.log(`✅ Visual Queries Generated: ${hasVisualQueries ? 'YES' : 'NO'}`);
    console.log(`✅ Thumbnail Psychology: ${hasThumbnailPsychology ? 'YES' : 'NO'}`);
    console.log(`✅ Visual Validations Found: ${hasVisualValidations ? 'YES' : 'NO'}`);
    console.log(`✅ Thumbnail Analysis Enabled: ${result.debug.thumbnail_analysis_enabled ? 'YES' : 'NO'}`);
    
    const enhancementScore = [hasVisualElements, hasVisualQueries, hasVisualValidations, hasThumbnailPsychology, result.debug.thumbnail_analysis_enabled].filter(Boolean).length;
    console.log(`\n📊 Enhancement Score: ${enhancementScore}/5`);
    
    if (enhancementScore >= 4) {
      console.log('🎉 ENHANCEMENT SUCCESSFUL - Multi-modal analysis working well!');
    } else if (enhancementScore >= 2) {
      console.log('⚠️ PARTIAL SUCCESS - Some enhancements working, others need improvement');
    } else {
      console.log('❌ ENHANCEMENT NEEDS WORK - Falling back to text-only analysis');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Make sure the development server is running:');
      console.log('   npm run dev');
    }
  }
}

// Run the test
testEnhancedPattern().catch(console.error);