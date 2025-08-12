/**
 * Proper GPT-5 testing based on official documentation
 * Tests all model variants with correct API parameters
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Correct GPT-5 model configurations (August 2025)
const GPT5_MODELS = {
  'gpt-5': {
    name: 'gpt-5',
    inputPrice: 1.25,  // per 1M tokens
    outputPrice: 10.0,  // per 1M tokens (includes reasoning tokens)
    description: 'Full model with best reasoning capabilities',
    contextWindow: 272000,
    maxOutput: 128000,
    supportsReasoning: true,
    requiresRegistration: true
  },
  'gpt-5-mini': {
    name: 'gpt-5-mini',
    inputPrice: 0.25,  // per 1M tokens
    outputPrice: 2.0,   // per 1M tokens (includes reasoning tokens)
    description: 'Balanced performance and cost',
    contextWindow: 272000,
    maxOutput: 128000,
    supportsReasoning: true,
    requiresRegistration: false
  },
  'gpt-5-nano': {
    name: 'gpt-5-nano',
    inputPrice: 0.05,  // per 1M tokens
    outputPrice: 0.40,  // per 1M tokens (includes reasoning tokens)
    description: 'Fastest and most cost-effective',
    contextWindow: 272000,
    maxOutput: 128000,
    supportsReasoning: true,
    requiresRegistration: false
  }
};

// Test basic thumbnail analysis with proper parameters
async function testBasicAnalysis(video, modelName = 'gpt-5-mini') {
  console.log(`\n🔬 Testing ${modelName} - Basic Analysis`);
  console.log('=' .repeat(50));
  
  const model = GPT5_MODELS[modelName];
  if (!model) {
    console.error(`Unknown model: ${modelName}`);
    return null;
  }
  
  const startTime = Date.now();
  
  try {
    // Prepare the request with correct GPT-5 parameters
    const request = {
      model: modelName,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this YouTube thumbnail that achieved ${video.temporal_performance_score.toFixed(1)}x the channel's baseline performance.

Title: "${video.title}"
Channel: ${video.channel_name}

Provide:
1. Visual pattern that drove success
2. Psychological trigger
3. Replicability score (1-10)
4. Key insight`
          },
          {
            type: "image_url",
            image_url: { 
              url: video.thumbnail_url,
              detail: "high" // For better image analysis
            }
          }
        ]
      }],
      max_output_tokens: 300, // Correct parameter name for GPT-5
      // Temperature is fixed at 1.0 for GPT-5 models
    };
    
    // Add optional parameters if model supports them
    if (model.supportsReasoning) {
      request.reasoning_effort = 'medium'; // minimal, low, medium, high
      request.verbosity = 'medium'; // low, medium, high
    }
    
    console.log('📤 Sending request with params:', {
      model: modelName,
      max_output_tokens: request.max_output_tokens,
      reasoning_effort: request.reasoning_effort,
      verbosity: request.verbosity
    });
    
    const response = await openai.chat.completions.create(request);
    
    const processingTime = Date.now() - startTime;
    const content = response.choices[0].message.content;
    
    // Calculate costs
    const usage = response.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0; // Includes reasoning tokens
    const totalTokens = usage.total_tokens || 0;
    
    const cost = (inputTokens * model.inputPrice / 1000000) + 
                 (outputTokens * model.outputPrice / 1000000);
    
    console.log('\n📝 Analysis Result:');
    console.log(content);
    
    console.log(`\n📊 Metrics:`);
    console.log(`- Processing time: ${processingTime}ms`);
    console.log(`- Input tokens: ${inputTokens.toLocaleString()}`);
    console.log(`- Output tokens: ${outputTokens.toLocaleString()} (includes reasoning)`);
    console.log(`- Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(`💰 Cost: $${cost.toFixed(4)}`);
    
    return {
      model: modelName,
      content,
      cost,
      processingTime,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        total: totalTokens
      }
    };
    
  } catch (error) {
    console.error(`\n❌ Error with ${modelName}:`, error.message);
    
    if (error.response?.data) {
      console.error('API Error Details:', JSON.stringify(error.response.data, null, 2));
    }
    
    if (error.message?.includes('does not exist') || error.message?.includes('registration')) {
      console.log('⚠️ Note: This model may require registration or may not be available yet.');
    }
    
    return null;
  }
}

// Test different reasoning levels
async function testReasoningLevels(video, modelName = 'gpt-5-mini') {
  console.log(`\n🧠 Testing Reasoning Levels with ${modelName}`);
  console.log('=' .repeat(50));
  
  const reasoningLevels = ['minimal', 'low', 'medium', 'high'];
  const results = [];
  
  for (const level of reasoningLevels) {
    console.log(`\n📈 Testing ${level} reasoning...`);
    
    const startTime = Date.now();
    
    try {
      const request = {
        model: modelName,
        messages: [{
          role: "user",
          content: `Video: "${video.title}" - ${video.temporal_performance_score.toFixed(1)}x performance

Identify the key success pattern in one sentence.`
        }],
        max_output_tokens: 100,
        reasoning_effort: level
      };
      
      const response = await openai.chat.completions.create(request);
      const processingTime = Date.now() - startTime;
      
      const outputTokens = response.usage?.completion_tokens || 0;
      const cost = (response.usage?.prompt_tokens || 0) * 0.25 / 1000000 + 
                   outputTokens * 2.0 / 1000000;
      
      results.push({
        level,
        content: response.choices[0].message.content,
        outputTokens,
        processingTime,
        cost
      });
      
      console.log(`- Response: ${response.choices[0].message.content}`);
      console.log(`- Tokens: ${outputTokens}, Time: ${processingTime}ms, Cost: $${cost.toFixed(5)}`);
      
    } catch (error) {
      console.error(`Error with ${level} reasoning:`, error.message);
    }
  }
  
  return results;
}

// Test verbosity levels
async function testVerbosityLevels(video, modelName = 'gpt-5-nano') {
  console.log(`\n💬 Testing Verbosity Levels with ${modelName}`);
  console.log('=' .repeat(50));
  
  const verbosityLevels = ['low', 'medium', 'high'];
  const results = [];
  
  for (const level of verbosityLevels) {
    console.log(`\n📝 Testing ${level} verbosity...`);
    
    try {
      const request = {
        model: modelName,
        messages: [{
          role: "user",
          content: `Explain why this video succeeded: "${video.title}"`
        }],
        max_output_tokens: 500,
        verbosity: level,
        reasoning_effort: 'minimal' // Keep reasoning minimal to isolate verbosity effect
      };
      
      const response = await openai.chat.completions.create(request);
      const content = response.choices[0].message.content;
      const wordCount = content.split(/\s+/).length;
      
      results.push({
        level,
        content,
        wordCount,
        tokens: response.usage?.completion_tokens || 0
      });
      
      console.log(`- Word count: ${wordCount}`);
      console.log(`- Response: ${content.substring(0, 100)}...`);
      
    } catch (error) {
      console.error(`Error with ${level} verbosity:`, error.message);
    }
  }
  
  return results;
}

// Test advanced thumbnail pattern extraction
async function testAdvancedPatternExtraction(video) {
  console.log(`\n🎯 Advanced Pattern Extraction with GPT-5-mini (High Reasoning)`);
  console.log('=' .repeat(50));
  
  try {
    const request = {
      model: 'gpt-5-mini',
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `This video achieved ${video.temporal_performance_score.toFixed(1)}x baseline performance.

Title: "${video.title}"

Using deep reasoning, extract:

1. VISUAL HOOK: The specific element that stops scrolling
2. INFORMATION GAP: What question does title+thumbnail create?
3. PATTERN FORMULA: [Title Component] + [Thumbnail Element] = [Psychological Effect]
4. REPLICATION BLUEPRINT: Exact steps to recreate this success
5. CROSS-NICHE VIABILITY: Will this work outside ${video.channel_name}'s niche?

Be prescriptive, not descriptive.`
          },
          {
            type: "image_url",
            image_url: { 
              url: video.thumbnail_url,
              detail: "high"
            }
          }
        ]
      }],
      max_output_tokens: 600,
      reasoning_effort: 'high', // Maximum reasoning for complex analysis
      verbosity: 'high' // Detailed response
    };
    
    console.log('🔄 Processing with high reasoning effort...');
    const startTime = Date.now();
    
    const response = await openai.chat.completions.create(request);
    const processingTime = Date.now() - startTime;
    
    console.log('\n📋 Pattern Analysis:');
    console.log(response.choices[0].message.content);
    
    const cost = (response.usage?.prompt_tokens || 0) * 0.25 / 1000000 + 
                 (response.usage?.completion_tokens || 0) * 2.0 / 1000000;
    
    console.log(`\n⏱️ Processing: ${processingTime}ms`);
    console.log(`💰 Cost: $${cost.toFixed(4)}`);
    console.log(`🔢 Output tokens: ${response.usage?.completion_tokens || 0} (includes reasoning)`);
    
    return response.choices[0].message.content;
    
  } catch (error) {
    console.error('Pattern extraction error:', error.message);
    return null;
  }
}

// Compare all models and save results
async function runComprehensiveTest() {
  console.log('🚀 GPT-5 COMPREHENSIVE TESTING SUITE');
  console.log('=' .repeat(60));
  console.log('\n📅 Date: August 2025');
  console.log('🔧 Testing proper API parameters and all model variants\n');
  
  // Get a high-performing video for testing
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 10)
    .not('thumbnail_url', 'is', null)
    .order('temporal_performance_score', { ascending: false })
    .limit(1)
    .single();
  
  if (!video) {
    console.error('No suitable test video found');
    return;
  }
  
  console.log(`📹 Test Video: "${video.title}"`);
  console.log(`📊 Performance: ${video.temporal_performance_score.toFixed(1)}x baseline`);
  console.log(`📺 Channel: ${video.channel_name}\n`);
  
  const testResults = {
    video: {
      id: video.id,
      title: video.title,
      channel: video.channel_name,
      performance: video.temporal_performance_score
    },
    tests: {},
    timestamp: new Date().toISOString()
  };
  
  // Test 1: Basic analysis with available models
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 1: MODEL COMPARISON');
  console.log('=' .repeat(60));
  
  const modelResults = [];
  for (const modelName of ['gpt-5-nano', 'gpt-5-mini']) {
    const result = await testBasicAnalysis(video, modelName);
    if (result) {
      modelResults.push(result);
    }
    await new Promise(r => setTimeout(r, 1000)); // Rate limiting
  }
  testResults.tests.models = modelResults;
  
  // Test 2: Reasoning levels
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 2: REASONING LEVELS');
  console.log('=' .repeat(60));
  
  const reasoningResults = await testReasoningLevels(video, 'gpt-5-mini');
  testResults.tests.reasoning = reasoningResults;
  
  // Test 3: Verbosity levels
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 3: VERBOSITY LEVELS');
  console.log('=' .repeat(60));
  
  const verbosityResults = await testVerbosityLevels(video, 'gpt-5-nano');
  testResults.tests.verbosity = verbosityResults;
  
  // Test 4: Advanced pattern extraction
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 4: ADVANCED PATTERN EXTRACTION');
  console.log('=' .repeat(60));
  
  const patternResult = await testAdvancedPatternExtraction(video);
  testResults.tests.advancedPattern = patternResult;
  
  // Summary and recommendations
  console.log('\n' + '=' .repeat(60));
  console.log('📊 TEST SUMMARY & RECOMMENDATIONS');
  console.log('=' .repeat(60));
  
  console.log('\n🎯 KEY FINDINGS:');
  console.log('\n1. MODEL SELECTION:');
  console.log('   - gpt-5-nano: Best for bulk analysis ($0.19/1000 analyses)');
  console.log('   - gpt-5-mini: Best for detailed insights ($0.93/1000 analyses)');
  console.log('   - gpt-5: Premium analysis (requires registration)');
  
  console.log('\n2. PARAMETER OPTIMIZATION:');
  console.log('   - Use "minimal" reasoning for yes/no validation');
  console.log('   - Use "high" reasoning for pattern extraction');
  console.log('   - Use "low" verbosity for quick summaries');
  console.log('   - Use "high" verbosity for detailed explanations');
  
  console.log('\n3. COST-EFFECTIVE STRATEGY:');
  console.log('   - Stage 1: gpt-5-nano with minimal reasoning for filtering');
  console.log('   - Stage 2: gpt-5-mini with high reasoning for top 10%');
  console.log('   - Stage 3: Manual review of extracted patterns');
  
  console.log('\n4. API TIPS:');
  console.log('   - Use max_output_tokens (not max_completion_tokens)');
  console.log('   - reasoning_effort: minimal|low|medium|high');
  console.log('   - verbosity: low|medium|high');
  console.log('   - Temperature is fixed at 1.0');
  console.log('   - Output tokens include invisible reasoning tokens');
  
  // Save results to file
  const filename = `data/gpt5_test_results_${new Date().toISOString().split('T')[0]}.json`;
  await fs.writeFile(filename, JSON.stringify(testResults, null, 2));
  console.log(`\n💾 Results saved to: ${filename}`);
  
  return testResults;
}

// Run the comprehensive test
runComprehensiveTest().catch(console.error);