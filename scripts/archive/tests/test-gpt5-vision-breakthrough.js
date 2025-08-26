/**
 * GPT-5 Vision Testing - Finding what works
 * Testing different strategies to get actual content from GPT-5 models
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

// Test different prompting strategies to get content
async function testPromptingStrategies(thumbnailUrl, title) {
  console.log('\n🧪 TESTING PROMPTING STRATEGIES FOR GPT-5\n');
  console.log('=' .repeat(60));
  
  const strategies = [
    {
      name: 'Direct Command',
      prompt: 'Say "This thumbnail works because of the contrast." exactly.',
      expectsExact: 'This thumbnail works because of the contrast.'
    },
    {
      name: 'Simple Question',
      prompt: 'Red or blue for thumbnails?',
      expectsShort: true
    },
    {
      name: 'Yes/No Question',
      prompt: 'Is this thumbnail effective? Answer yes or no.',
      expectsShort: true
    },
    {
      name: 'Numbered List',
      prompt: 'List 3 colors in this thumbnail:\n1.\n2.\n3.',
      expectsList: true
    },
    {
      name: 'Complete the Sentence',
      prompt: 'Complete: This thumbnail is effective because it uses ___',
      expectsCompletion: true
    },
    {
      name: 'Multiple Choice',
      prompt: 'What makes this thumbnail work?\nA) Bright colors\nB) Clear text\nC) Face closeup\nAnswer with letter only.',
      expectsLetter: true
    },
    {
      name: 'JSON Output',
      prompt: 'Output JSON only: {"effective": true/false, "reason": "one word"}',
      expectsJSON: true
    },
    {
      name: 'Score Only',
      prompt: 'Rate this thumbnail 1-10. Output number only.',
      expectsNumber: true
    }
  ];
  
  const results = [];
  
  for (const strategy of strategies) {
    console.log(`\n📝 Strategy: ${strategy.name}`);
    console.log(`Prompt: "${strategy.prompt}"`);
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: strategy.prompt },
            { type: 'image_url', image_url: { url: thumbnailUrl, detail: 'low' } }
          ]
        }],
        max_completion_tokens: 50
      });
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens || 0;
      
      results.push({
        strategy: strategy.name,
        gotContent: !!content,
        content: content || '(empty)',
        reasoningTokens,
        totalTokens: usage.completion_tokens
      });
      
      console.log(`Result: ${content || '❌ EMPTY'}`);
      console.log(`Tokens: ${usage.completion_tokens} (${reasoningTokens} reasoning)`);
      
      // Check if we got expected format
      if (content) {
        if (strategy.expectsExact && content === strategy.expectsExact) {
          console.log('✅ Got exact match!');
        } else if (strategy.expectsShort && content.length < 20) {
          console.log('✅ Got short response as expected');
        } else if (strategy.expectsJSON) {
          try {
            JSON.parse(content);
            console.log('✅ Valid JSON output');
          } catch {
            console.log('⚠️ Not valid JSON');
          }
        }
      }
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
      results.push({
        strategy: strategy.name,
        error: error.message
      });
    }
    
    await new Promise(r => setTimeout(r, 500)); // Rate limit
  }
  
  return results;
}

// Test with system messages
async function testSystemMessages(thumbnailUrl) {
  console.log('\n🎭 TESTING SYSTEM MESSAGE APPROACHES\n');
  console.log('=' .repeat(60));
  
  const approaches = [
    {
      name: 'Assistant Role',
      system: 'You are a thumbnail analyzer. Always respond with exactly one word.',
      user: 'What color dominates this thumbnail?'
    },
    {
      name: 'Output Format Constraint',
      system: 'You must always output valid JSON and nothing else.',
      user: 'Analyze this thumbnail. Output: {"score": 1-10}'
    },
    {
      name: 'Terse Mode',
      system: 'You are in terse mode. Maximum 5 words per response.',
      user: 'Why does this thumbnail work?'
    },
    {
      name: 'Tool Mode',
      system: 'You are a classification tool. Output classifications only, no explanations.',
      user: 'Classify thumbnail style: minimal/busy/balanced'
    }
  ];
  
  const results = [];
  
  for (const approach of approaches) {
    console.log(`\n🎯 ${approach.name}`);
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [
          { role: 'system', content: approach.system },
          { 
            role: 'user', 
            content: [
              { type: 'text', text: approach.user },
              { type: 'image_url', image_url: { url: thumbnailUrl, detail: 'low' } }
            ]
          }
        ],
        max_completion_tokens: 30
      });
      
      const content = response.choices[0].message.content;
      console.log(`System: "${approach.system}"`);
      console.log(`User: "${approach.user}"`);
      console.log(`Response: ${content || '❌ EMPTY'}`);
      
      results.push({
        approach: approach.name,
        gotContent: !!content,
        content: content || '(empty)'
      });
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

// Compare GPT-5 vs GPT-4o for same analysis
async function compareModels(video) {
  console.log('\n🔄 GPT-5 vs GPT-4o COMPARISON\n');
  console.log('=' .repeat(60));
  
  const prompt = `This video got ${video.temporal_performance_score.toFixed(1)}x normal performance.

Title: "${video.title}"

In 50 words or less, identify the ONE visual element that made this thumbnail successful.`;
  
  const models = [
    { name: 'gpt-4o', paramName: 'max_tokens' },
    { name: 'gpt-4o-mini', paramName: 'max_tokens' },
    { name: 'gpt-5-nano', paramName: 'max_completion_tokens' },
    { name: 'gpt-5-mini', paramName: 'max_completion_tokens' }
  ];
  
  const results = [];
  
  for (const model of models) {
    console.log(`\n📊 Testing ${model.name}`);
    console.log('-'.repeat(40));
    
    try {
      const startTime = Date.now();
      
      const params = {
        model: model.name,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { 
              type: 'image_url', 
              image_url: { 
                url: video.thumbnail_url,
                detail: 'high'
              }
            }
          ]
        }]
      };
      
      // Use correct parameter name for each model
      params[model.paramName] = 100;
      
      const response = await openai.chat.completions.create(params);
      const processingTime = Date.now() - startTime;
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      
      // Calculate costs
      const costs = {
        'gpt-4o': { input: 2.50, output: 10.00 },
        'gpt-4o-mini': { input: 0.15, output: 0.60 },
        'gpt-5-nano': { input: 0.05, output: 0.40 },
        'gpt-5-mini': { input: 0.25, output: 2.00 }
      };
      
      const modelCost = costs[model.name];
      const cost = (usage.prompt_tokens * modelCost.input / 1000000) + 
                   (usage.completion_tokens * modelCost.output / 1000000);
      
      results.push({
        model: model.name,
        hasContent: !!content,
        contentLength: content ? content.length : 0,
        processingTime,
        cost,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0
      });
      
      if (content) {
        console.log(`✅ Got content (${content.length} chars)`);
        console.log(`\nAnalysis:\n${content}`);
      } else {
        console.log(`❌ No content returned`);
        console.log(`Reasoning tokens: ${usage.completion_tokens_details?.reasoning_tokens}`);
      }
      
      console.log(`\nMetrics:`);
      console.log(`- Time: ${processingTime}ms`);
      console.log(`- Cost: $${cost.toFixed(5)}`);
      console.log(`- Tokens: ${usage.prompt_tokens} in, ${usage.completion_tokens} out`);
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      results.push({
        model: model.name,
        error: error.message
      });
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return results;
}

// Test with actual production use case
async function testProductionUseCase(video) {
  console.log('\n🏭 PRODUCTION USE CASE TEST\n');
  console.log('=' .repeat(60));
  
  // Pattern extraction prompt that we'd actually use
  const productionPrompt = `Video performance: ${video.temporal_performance_score.toFixed(1)}x baseline
Title: "${video.title}"

Extract pattern:
1. Visual hook (5 words max):
2. Click trigger (5 words max):
3. Success formula (10 words max):`;
  
  console.log('Testing pattern extraction with both GPT-4o and GPT-5...\n');
  
  // Test with GPT-4o (known working)
  console.log('📊 GPT-4o:');
  try {
    const gpt4Response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: productionPrompt },
          { type: 'image_url', image_url: { url: video.thumbnail_url, detail: 'high' } }
        ]
      }],
      max_tokens: 100
    });
    
    console.log(gpt4Response.choices[0].message.content || 'No content');
    const gpt4Cost = (gpt4Response.usage.prompt_tokens * 0.15 / 1000000) + 
                     (gpt4Response.usage.completion_tokens * 0.60 / 1000000);
    console.log(`Cost: $${gpt4Cost.toFixed(5)}`);
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  // Test with GPT-5-nano
  console.log('\n📊 GPT-5-nano:');
  try {
    const gpt5Response = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: productionPrompt },
          { type: 'image_url', image_url: { url: video.thumbnail_url, detail: 'high' } }
        ]
      }],
      max_completion_tokens: 100
    });
    
    const content = gpt5Response.choices[0].message.content;
    if (content) {
      console.log(content);
      console.log('✅ GPT-5 IS WORKING!');
    } else {
      console.log('❌ Still returning empty content');
      console.log(`Used ${gpt5Response.usage.completion_tokens} reasoning tokens`);
    }
    
    const gpt5Cost = (gpt5Response.usage.prompt_tokens * 0.05 / 1000000) + 
                     (gpt5Response.usage.completion_tokens * 0.40 / 1000000);
    console.log(`Cost: $${gpt5Cost.toFixed(5)}`);
    
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

// Test structured output mode
async function testStructuredOutput(thumbnailUrl) {
  console.log('\n🏗️ TESTING STRUCTURED OUTPUT\n');
  console.log('=' .repeat(60));
  
  const schema = {
    type: 'object',
    properties: {
      dominant_color: { type: 'string' },
      has_text: { type: 'boolean' },
      emotion: { type: 'string', enum: ['happy', 'sad', 'neutral', 'excited', 'surprised'] },
      effectiveness_score: { type: 'integer', minimum: 1, maximum: 10 }
    },
    required: ['dominant_color', 'has_text', 'emotion', 'effectiveness_score']
  };
  
  try {
    console.log('Testing with response_format...');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this thumbnail and provide structured data.' },
          { type: 'image_url', image_url: { url: thumbnailUrl, detail: 'low' } }
        ]
      }],
      max_completion_tokens: 100,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'thumbnail_analysis',
          strict: true,
          schema: schema
        }
      }
    });
    
    const content = response.choices[0].message.content;
    if (content) {
      console.log('✅ Got structured output:');
      console.log(JSON.parse(content));
    } else {
      console.log('❌ Empty response even with structured output');
    }
    
  } catch (error) {
    console.log(`Error with structured output: ${error.message}`);
    
    // Try simpler JSON mode
    console.log('\nTrying simple JSON mode...');
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Output JSON: {"color": "main color", "score": 1-10}' },
            { type: 'image_url', image_url: { url: thumbnailUrl, detail: 'low' } }
          ]
        }],
        max_completion_tokens: 50,
        response_format: { type: 'json_object' }
      });
      
      const content = response.choices[0].message.content;
      console.log(content ? `Result: ${content}` : '❌ Still empty');
      
    } catch (err) {
      console.log(`JSON mode error: ${err.message}`);
    }
  }
}

// Main test runner
async function runBreakthroughTest() {
  console.log('🚀 GPT-5 VISION BREAKTHROUGH TEST');
  console.log('=' .repeat(60));
  console.log('Finding what works with GPT-5 vision models\n');
  
  // Get test video
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 10)
    .not('thumbnail_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1)
    .single();
  
  if (!video) {
    console.log('No test video found');
    return;
  }
  
  console.log(`📹 Test Video: "${video.title}"`);
  console.log(`📊 Performance: ${video.temporal_performance_score.toFixed(1)}x`);
  console.log(`🖼️ Thumbnail: ${video.thumbnail_url}\n`);
  
  const results = {
    video: {
      id: video.id,
      title: video.title,
      performance: video.temporal_performance_score,
      thumbnail: video.thumbnail_url
    },
    tests: {}
  };
  
  // Test 1: Prompting strategies
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: PROMPTING STRATEGIES');
  console.log('='.repeat(60));
  results.tests.promptingStrategies = await testPromptingStrategies(video.thumbnail_url, video.title);
  
  // Test 2: System messages
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: SYSTEM MESSAGES');
  console.log('='.repeat(60));
  results.tests.systemMessages = await testSystemMessages(video.thumbnail_url);
  
  // Test 3: Model comparison
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: MODEL COMPARISON');
  console.log('='.repeat(60));
  results.tests.modelComparison = await compareModels(video);
  
  // Test 4: Production use case
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: PRODUCTION USE CASE');
  console.log('='.repeat(60));
  await testProductionUseCase(video);
  
  // Test 5: Structured output
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: STRUCTURED OUTPUT');
  console.log('='.repeat(60));
  await testStructuredOutput(video.thumbnail_url);
  
  // Analyze results
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS ANALYSIS');
  console.log('='.repeat(60));
  
  // Check which strategies got content
  const workingStrategies = results.tests.promptingStrategies?.filter(s => s.gotContent) || [];
  const workingApproaches = results.tests.systemMessages?.filter(a => a.gotContent) || [];
  
  console.log(`\n✅ Working Strategies: ${workingStrategies.length}/${results.tests.promptingStrategies?.length || 0}`);
  workingStrategies.forEach(s => console.log(`  - ${s.strategy}: "${s.content}"`));
  
  console.log(`\n✅ Working System Approaches: ${workingApproaches.length}/${results.tests.systemMessages?.length || 0}`);
  workingApproaches.forEach(a => console.log(`  - ${a.approach}: "${a.content}"`));
  
  // Model comparison summary
  console.log('\n📈 Model Performance:');
  const modelResults = results.tests.modelComparison || [];
  modelResults.forEach(m => {
    if (!m.error) {
      console.log(`  ${m.model}:`);
      console.log(`    - Has content: ${m.hasContent ? 'Yes' : 'No'}`);
      console.log(`    - Cost: $${m.cost?.toFixed(5) || 'N/A'}`);
      console.log(`    - Time: ${m.processingTime}ms`);
    }
  });
  
  // Save results
  const filename = `data/gpt5_vision_breakthrough_${new Date().toISOString().split('T')[0]}.json`;
  await fs.writeFile(filename, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to: ${filename}`);
  
  // Final recommendations
  console.log('\n' + '='.repeat(60));
  console.log('🎯 RECOMMENDATIONS');
  console.log('='.repeat(60));
  
  if (workingStrategies.length > 0) {
    console.log('\n✅ GPT-5 CAN return content with specific prompting!');
    console.log('Best strategies:');
    workingStrategies.slice(0, 3).forEach(s => {
      console.log(`  - ${s.strategy}`);
    });
  } else {
    console.log('\n⚠️ GPT-5 still not returning visible content');
    console.log('Fallback to GPT-4o-mini for now (4x more expensive but works)');
  }
  
  console.log('\n💡 For production:');
  console.log('1. Use GPT-4o-mini until GPT-5 is fixed ($0.15/$0.60 per 1M)');
  console.log('2. Test GPT-5 daily for when it starts working');
  console.log('3. Prepare batch processing for when GPT-5-nano works');
  console.log('4. Expected savings: 12x cost reduction once working');
}

// Run the breakthrough test
runBreakthroughTest().catch(console.error);