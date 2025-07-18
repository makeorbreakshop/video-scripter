/**
 * System Health Check for Title Generation
 * Run this to verify all components are working correctly
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import chalk from 'chalk';

dotenv.config();

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  details?: any;
}

const tests: TestResult[] = [];

async function log(message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') {
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  };
  console.log(colors[type](message));
}

async function testEnvironmentVariables() {
  log('\n🔧 Testing Environment Variables...', 'info');
  
  const requiredVars = [
    'PINECONE_API_KEY',
    'PINECONE_INDEX_NAME',
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  if (missingVars.length === 0) {
    tests.push({
      name: 'Environment Variables',
      status: 'pass',
      message: 'All required environment variables are set'
    });
    log('✅ All environment variables found', 'success');
  } else {
    tests.push({
      name: 'Environment Variables',
      status: 'fail',
      message: `Missing: ${missingVars.join(', ')}`,
      details: missingVars
    });
    log(`❌ Missing variables: ${missingVars.join(', ')}`, 'error');
  }
}

async function testPineconeConnection() {
  log('\n🔌 Testing Pinecone Connection...', 'info');
  
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const stats = await index.describeIndexStats();
    
    tests.push({
      name: 'Pinecone Connection',
      status: 'pass',
      message: `Connected successfully. ${stats.totalRecordCount} vectors in index`,
      details: {
        recordCount: stats.totalRecordCount,
        dimension: stats.dimension,
        indexFullness: stats.indexFullness
      }
    });
    log(`✅ Pinecone connected: ${stats.totalRecordCount} vectors`, 'success');
    
    // Test search functionality
    const testEmbedding = new Array(512).fill(0.1);
    const queryResponse = await index.query({
      vector: testEmbedding,
      topK: 5,
      includeMetadata: true,
      includeValues: true,
    });
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      log(`✅ Search test passed: ${queryResponse.matches.length} results`, 'success');
    } else {
      log('⚠️  Search returned no results', 'warning');
    }
    
  } catch (error) {
    tests.push({
      name: 'Pinecone Connection',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error
    });
    log(`❌ Pinecone connection failed: ${error}`, 'error');
  }
}

async function testSupabaseConnection() {
  log('\n🗄️  Testing Supabase Connection...', 'info');
  
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // Test basic query
    const { data, error } = await supabase
      .from('videos')
      .select('count')
      .limit(1);
    
    if (error) throw error;
    
    // Get video count
    const { count } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    tests.push({
      name: 'Supabase Connection',
      status: 'pass',
      message: `Connected successfully. ${count} videos in database`,
      details: { videoCount: count }
    });
    log(`✅ Supabase connected: ${count} videos`, 'success');
    
  } catch (error) {
    tests.push({
      name: 'Supabase Connection',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error
    });
    log(`❌ Supabase connection failed: ${error}`, 'error');
  }
}

async function testOpenAIConnection() {
  log('\n🤖 Testing OpenAI Connection...', 'info');
  
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
    });
    
    // Test embedding generation
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'test',
      dimensions: 512
    });
    
    tests.push({
      name: 'OpenAI Connection',
      status: 'pass',
      message: 'Connected successfully. Embeddings working',
      details: {
        model: 'text-embedding-3-small',
        dimensions: embeddingResponse.data[0].embedding.length
      }
    });
    log('✅ OpenAI connected and embeddings working', 'success');
    
  } catch (error) {
    tests.push({
      name: 'OpenAI Connection',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error
    });
    log(`❌ OpenAI connection failed: ${error}`, 'error');
  }
}

async function testTitleGenerationAPI() {
  log('\n🎯 Testing Title Generation API...', 'info');
  
  try {
    const testConcept = 'woodworking tools for beginners';
    log(`Testing with concept: "${testConcept}"`, 'info');
    
    const response = await fetch('http://localhost:3000/api/youtube/patterns/generate-titles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        concept: testConcept,
        options: {
          minPerformance: 2.5,
          minConfidence: 0.6,
          minSampleSize: 5,
          maxSuggestions: 10,
          balanceTypes: true
        }
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    const widePatterns = data.suggestions.filter((s: any) => s.pattern.pattern_type === 'WIDE').length;
    const deepPatterns = data.suggestions.filter((s: any) => s.pattern.pattern_type === 'DEEP').length;
    
    tests.push({
      name: 'Title Generation API',
      status: 'pass',
      message: `Generated ${data.suggestions.length} patterns (${widePatterns} WIDE, ${deepPatterns} DEEP)`,
      details: {
        totalPatterns: data.suggestions.length,
        widePatterns,
        deepPatterns,
        processingTime: data.processing_time_ms,
        videosFound: data.debug?.totalVideosFound
      }
    });
    log(`✅ API test passed: ${data.suggestions.length} patterns in ${data.processing_time_ms}ms`, 'success');
    
    // Check for specific issues
    if (widePatterns === 0) {
      log('⚠️  No WIDE patterns found - check DBSCAN clustering', 'warning');
      tests.push({
        name: 'WIDE Pattern Detection',
        status: 'warning',
        message: 'No WIDE patterns detected',
        details: { clusters: data.debug?.poolAndCluster }
      });
    }
    
  } catch (error) {
    tests.push({
      name: 'Title Generation API',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      details: error
    });
    log(`❌ API test failed: ${error}`, 'error');
    log('Make sure the Next.js dev server is running on port 3000', 'warning');
  }
}

async function generateReport() {
  log('\n📊 Test Summary', 'info');
  log('═'.repeat(50), 'info');
  
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const warnings = tests.filter(t => t.status === 'warning').length;
  
  tests.forEach(test => {
    const icon = test.status === 'pass' ? '✅' : test.status === 'fail' ? '❌' : '⚠️';
    const color = test.status === 'pass' ? 'success' : test.status === 'fail' ? 'error' : 'warning';
    log(`${icon} ${test.name}: ${test.message}`, color as any);
    if (test.details && test.status !== 'pass') {
      console.log(chalk.gray(JSON.stringify(test.details, null, 2)));
    }
  });
  
  log('═'.repeat(50), 'info');
  log(`Total: ${tests.length} | Passed: ${passed} | Failed: ${failed} | Warnings: ${warnings}`, 'info');
  
  if (failed > 0) {
    log('\n❌ System health check FAILED', 'error');
    process.exit(1);
  } else if (warnings > 0) {
    log('\n⚠️  System health check passed with warnings', 'warning');
    process.exit(0);
  } else {
    log('\n✅ System health check PASSED', 'success');
    process.exit(0);
  }
}

async function runAllTests() {
  console.clear();
  log('🏥 Running System Health Check for Title Generation', 'info');
  log('═'.repeat(50), 'info');
  
  await testEnvironmentVariables();
  
  if (tests.some(t => t.status === 'fail')) {
    log('\n⚠️  Skipping remaining tests due to missing environment variables', 'warning');
  } else {
    await testPineconeConnection();
    await testSupabaseConnection();
    await testOpenAIConnection();
    await testTitleGenerationAPI();
  }
  
  await generateReport();
}

// Run tests
runAllTests().catch(error => {
  log(`\n💥 Unexpected error: ${error}`, 'error');
  process.exit(1);
});