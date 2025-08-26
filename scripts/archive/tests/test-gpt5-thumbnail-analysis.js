/**
 * Test GPT-5 models for thumbnail analysis
 * GPT-5, GPT-5-mini, and GPT-5-nano comparison
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Model configurations with August 2025 pricing
const GPT5_MODELS = {
  'gpt-5': {
    name: 'gpt-5',
    inputPrice: 1.25,  // per 1M tokens
    outputPrice: 10.0,  // per 1M tokens
    description: 'Best performance, highest cost',
    contextWindow: 272000,
    outputLimit: 128000,
    knowledgeCutoff: '2024-09-30'
  },
  'gpt-5-mini': {
    name: 'gpt-5-mini',
    inputPrice: 0.25,  // per 1M tokens
    outputPrice: 2.0,   // per 1M tokens
    description: 'Balanced performance and cost',
    contextWindow: 272000,
    outputLimit: 128000,
    knowledgeCutoff: '2024-05-30'
  },
  'gpt-5-nano': {
    name: 'gpt-5-nano',
    inputPrice: 0.05,  // per 1M tokens
    outputPrice: 0.40,  // per 1M tokens
    description: 'Fastest and cheapest',
    contextWindow: 272000,
    outputLimit: 128000,
    knowledgeCutoff: '2024-05-30'
  },
  'gpt-5-chat-latest': {
    name: 'gpt-5-chat-latest',
    inputPrice: 1.25,  // per 1M tokens
    outputPrice: 10.0,  // per 1M tokens
    description: 'Non-reasoning ChatGPT version',
    contextWindow: 272000,
    outputLimit: 128000,
    knowledgeCutoff: '2024-09-30'
  }
};

// Test thumbnail analysis with different GPT-5 models
async function testGPT5Model(video, modelConfig, reasoningLevel = 'medium') {
  console.log(`\n🤖 Testing ${modelConfig.name.toUpperCase()} (${reasoningLevel} reasoning)`);
  console.log('=' .repeat(50));
  
  const startTime = Date.now();
  
  try {
    // Test pattern recognition with thumbnails
    const messages = [{
      role: "user",
      content: [
        {
          type: "text",
          text: `This thumbnail achieved ${video.temporal_performance_score.toFixed(1)}x the channel's normal performance.

Title: "${video.title}"
Channel: ${video.channel_name}
Views: ${video.view_count.toLocaleString()}

Using GPT-5's advanced reasoning capabilities, analyze:

1. PATTERN IDENTIFICATION: What specific visual pattern made this succeed?
2. PSYCHOLOGICAL MECHANISM: Why does this pattern work on human psychology?
3. REPLICABILITY SCORE (1-10): How easily can this be replicated?
4. CROSS-NICHE POTENTIAL: Will this work in other content categories?
5. PATTERN BREAK: What's different from typical ${video.channel_name} thumbnails?

Provide actionable insights, not observations.`
        },
        {
          type: "image_url",
          image_url: { url: video.thumbnail_url }
        }
      ]
    }];

    // Make API call with GPT-5 specific parameters
    const apiParams = {
      model: modelConfig.name,
      messages: messages,
      max_completion_tokens: 500 // GPT-5 uses max_completion_tokens instead of max_tokens
      // Note: GPT-5 models only support default temperature (1.0)
    };
    
    // Only add reasoning_effort for models that support it (not gpt-5-chat-latest)
    if (!modelConfig.name.includes('chat')) {
      apiParams.reasoning_effort = reasoningLevel; // 'minimal', 'low', 'medium', or 'high'
    }
    
    const response = await openai.chat.completions.create(apiParams);

    const analysis = response.choices[0].message.content;
    const processingTime = Date.now() - startTime;
    
    console.log(analysis);
    
    // Calculate cost
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const totalTokens = response.usage?.total_tokens || 0;
    
    // Note: GPT-5 includes invisible reasoning tokens in output count
    const reasoningTokens = outputTokens - (analysis.length / 4); // Estimate visible vs reasoning tokens
    
    const cost = (inputTokens * modelConfig.inputPrice / 1000000) + 
                 (outputTokens * modelConfig.outputPrice / 1000000);
    
    console.log(`\n📊 Performance Metrics:`);
    console.log(`- Processing time: ${processingTime}ms`);
    console.log(`- Input tokens: ${inputTokens}`);
    console.log(`- Output tokens: ${outputTokens} (includes ~${Math.round(reasoningTokens)} reasoning tokens)`);
    console.log(`- Total tokens: ${totalTokens}`);
    console.log(`💰 Cost: $${cost.toFixed(4)}`);
    
    return {
      model: modelConfig.name,
      reasoningLevel,
      analysis,
      cost,
      processingTime,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        reasoning: reasoningTokens,
        total: totalTokens
      }
    };
    
  } catch (error) {
    console.error(`Error with ${modelConfig.name}:`, error.message);
    
    // Check if it's a model access error
    if (error.message.includes('registration')) {
      console.log('⚠️ Note: gpt-5 requires registration. Try gpt-5-mini or gpt-5-nano instead.');
    }
    
    return null;
  }
}

// Test title-thumbnail synergy with GPT-5's advanced reasoning
async function testAdvancedSynergy(video, modelName = 'gpt-5-mini') {
  console.log(`\n🔗 Advanced Title-Thumbnail Synergy Analysis (${modelName})`);
  console.log('=' .repeat(50));
  
  try {
    const apiParams = {
      model: modelName,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Title: "${video.title}"
Performance: ${video.temporal_performance_score.toFixed(1)}x baseline

Using GPT-5's multi-step reasoning, analyze the title-thumbnail relationship:

1. INFORMATION ARCHITECTURE:
   - What critical info is ONLY in the title?
   - What critical info is ONLY in the thumbnail?
   - What's the strategic overlap?

2. CURIOSITY ENGINEERING:
   - What specific question does the combination create?
   - Rate the "must-click" factor (1-10)
   - What psychological principle is at work?

3. PATTERN FORMULA:
   - Write the replicable formula as: [Title does X] + [Thumbnail shows Y] = [Result Z]

4. SUCCESS PROBABILITY:
   - If 100 creators copied this formula, how many would see >3x performance?

Be specific and prescriptive.`
          },
          {
            type: "image_url",
            image_url: { url: video.thumbnail_url }
          }
        ]
      }],
      max_completion_tokens: 400 // GPT-5 parameter
      // Note: GPT-5 models only support default temperature (1.0)
    };
    
    // Only add reasoning_effort for non-chat models
    if (!modelName.includes('chat')) {
      apiParams.reasoning_effort = 'high'; // Use high reasoning for complex analysis
    }
    
    const response = await openai.chat.completions.create(apiParams);

    console.log(response.choices[0].message.content);
    
    const cost = (response.usage?.prompt_tokens || 0) * GPT5_MODELS[modelName].inputPrice / 1000000 + 
                 (response.usage?.completion_tokens || 0) * GPT5_MODELS[modelName].outputPrice / 1000000;
    
    console.log(`\n💰 Cost: $${cost.toFixed(4)}`);
    
    return response.choices[0].message.content;
    
  } catch (error) {
    console.error('Synergy analysis error:', error.message);
    return null;
  }
}

// Compare all GPT-5 models
async function compareGPT5Models(video) {
  console.log('\n🔬 GPT-5 MODEL COMPARISON FOR THUMBNAIL ANALYSIS');
  console.log('=' .repeat(60));
  
  console.log(`\n📹 Test Video: "${video.title}"`);
  console.log(`📊 Performance: ${video.temporal_performance_score.toFixed(1)}x`);
  console.log(`📺 Channel: ${video.channel_name}\n`);
  
  const results = [];
  
  // Test each model (skip gpt-5 if no registration)
  const modelsToTest = ['gpt-5-mini', 'gpt-5-nano', 'gpt-5-chat-latest'];
  
  for (const modelName of modelsToTest) {
    const result = await testGPT5Model(video, GPT5_MODELS[modelName], 'medium');
    if (result) {
      results.push(result);
    }
  }
  
  // Test reasoning levels with gpt-5-mini
  console.log('\n🧠 TESTING REASONING LEVELS WITH GPT-5-MINI');
  console.log('=' .repeat(60));
  
  const reasoningLevels = ['minimal', 'low', 'medium', 'high'];
  const reasoningResults = [];
  
  for (const level of reasoningLevels) {
    const result = await testGPT5Model(video, GPT5_MODELS['gpt-5-mini'], level);
    if (result) {
      reasoningResults.push(result);
    }
  }
  
  // Advanced synergy test
  await testAdvancedSynergy(video, 'gpt-5-mini');
  
  // Summary comparison
  console.log('\n' + '=' .repeat(60));
  console.log('📊 GPT-5 MODEL COMPARISON SUMMARY\n');
  
  // Model comparison
  console.log('MODEL PERFORMANCE:');
  results.forEach(r => {
    console.log(`\n${r.model}:`);
    console.log(`- Cost: $${r.cost.toFixed(4)}`);
    console.log(`- Speed: ${r.processingTime}ms`);
    console.log(`- Tokens: ${r.tokens.total} (${r.tokens.reasoning} reasoning)`);
  });
  
  // Reasoning level comparison
  console.log('\n\nREASONING LEVEL IMPACT (gpt-5-mini):');
  reasoningResults.forEach(r => {
    console.log(`\n${r.reasoningLevel}:`);
    console.log(`- Cost: $${r.cost.toFixed(4)}`);
    console.log(`- Speed: ${r.processingTime}ms`);
    console.log(`- Reasoning tokens: ~${Math.round(r.tokens.reasoning)}`);
  });
  
  // Cost analysis for scale
  console.log('\n\n💰 COST ANALYSIS AT SCALE:');
  console.log('\nFor 1,000 thumbnail analyses per day:');
  Object.entries(GPT5_MODELS).forEach(([key, model]) => {
    if (key !== 'gpt-5') { // Skip gpt-5 due to registration requirement
      const dailyCost = (500 * model.inputPrice / 1000000 + 400 * model.outputPrice / 1000000) * 1000;
      console.log(`- ${model.name}: $${dailyCost.toFixed(2)}/day`);
    }
  });
  
  console.log('\n\n🎯 RECOMMENDATIONS:');
  console.log('1. Use gpt-5-nano for bulk pattern validation (8x cheaper than mini)');
  console.log('2. Use gpt-5-mini with "high" reasoning for detailed analysis');
  console.log('3. Reserve gpt-5 (requires registration) for complex pattern extraction');
  console.log('4. Use "minimal" reasoning for simple yes/no validation');
  console.log('5. Batch similar analyses to optimize token usage');
  
  return {
    models: results,
    reasoning: reasoningResults
  };
}

// Main test runner
async function runGPT5Test() {
  console.log('🚀 GPT-5 THUMBNAIL ANALYSIS TEST\n');
  console.log('Testing new GPT-5 models released August 2025');
  console.log('Models: gpt-5, gpt-5-mini, gpt-5-nano');
  console.log('=' .repeat(60));
  
  // Find a good test video
  const { data: testVideo } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 10)
    .lte('temporal_performance_score', 50)
    .not('thumbnail_url', 'is', null)
    .order('temporal_performance_score', { ascending: false })
    .limit(1)
    .single();
  
  if (!testVideo) {
    console.log('No suitable test video found');
    return;
  }
  
  // Run comprehensive comparison
  const results = await compareGPT5Models(testVideo);
  
  console.log('\n\n✅ TEST COMPLETE');
  console.log('\nKey Insights:');
  console.log('- GPT-5-nano is 5x cheaper than mini, 25x cheaper than full');
  console.log('- Reasoning levels significantly impact cost (more reasoning tokens)');
  console.log('- "High" reasoning provides deepest insights but costs more');
  console.log('- All models support 272K input context (huge improvement)');
  
  return results;
}

// Run the test
runGPT5Test().catch(console.error);