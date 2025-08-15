#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log('🏥 MCP Server Health Check');
console.log('=' .repeat(60));

let healthScore = 0;
let totalChecks = 0;

async function checkEnvironment() {
  console.log('\n📋 Environment Variables:');
  totalChecks++;
  
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PINECONE_API_KEY',
    'PINECONE_INDEX_NAME',
    'OPENAI_API_KEY'
  ];
  
  let allPresent = true;
  for (const key of required) {
    const value = process.env[key];
    if (value) {
      console.log(`  ✅ ${key}: ${value.slice(0, 20)}...`);
    } else {
      console.log(`  ❌ ${key}: MISSING`);
      allPresent = false;
    }
  }
  
  if (allPresent) {
    healthScore++;
    console.log('  ✅ All required environment variables present');
  } else {
    console.log('  ❌ Some environment variables missing');
  }
}

async function checkSupabase() {
  console.log('\n🗄️  Supabase Connection:');
  totalChecks++;
  
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Try a simple query - just fetch one record
    const { data, error } = await supabase
      .from('videos')
      .select('id')
      .limit(1)
      .single();
    
    if (error) throw error;
    
    console.log('  ✅ Connected to Supabase successfully');
    console.log(`  📊 Successfully fetched video: ${data.id}`);
    healthScore++;
  } catch (error) {
    console.log(`  ❌ Supabase connection failed: ${error.message}`);
  }
}

async function checkPinecone() {
  console.log('\n🔍 Pinecone Connection:');
  totalChecks++;
  
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const stats = await index.describeIndexStats();
    
    console.log('  ✅ Connected to Pinecone successfully');
    console.log(`  📊 Index has ${stats.totalRecordCount?.toLocaleString() || 0} vectors`);
    console.log(`  📊 Namespaces: ${Object.keys(stats.namespaces || {}).join(', ') || 'default'}`);
    healthScore++;
  } catch (error) {
    console.log(`  ❌ Pinecone connection failed: ${error.message}`);
  }
}

async function checkOpenAI() {
  console.log('\n🤖 OpenAI Connection:');
  totalChecks++;
  
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    // Test with a simple embedding
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'test',
      dimensions: 512
    });
    
    if (response.data && response.data[0].embedding) {
      console.log('  ✅ OpenAI API connected successfully');
      console.log(`  📊 Embedding model: text-embedding-3-small (512 dimensions)`);
      healthScore++;
    }
  } catch (error) {
    console.log(`  ❌ OpenAI connection failed: ${error.message}`);
  }
}

async function checkBuildStatus() {
  console.log('\n🔨 Build Status:');
  totalChecks++;
  
  try {
    const { access } = await import('fs/promises');
    const distPath = path.join(__dirname, 'dist', 'index.js');
    
    await access(distPath);
    console.log('  ✅ Server is built (dist/index.js exists)');
    
    // Check if build is recent
    const { stat } = await import('fs/promises');
    const stats = await stat(distPath);
    const ageMinutes = (Date.now() - stats.mtime.getTime()) / 1000 / 60;
    
    if (ageMinutes < 60) {
      console.log(`  📊 Build is ${ageMinutes.toFixed(0)} minutes old (fresh)`);
    } else if (ageMinutes < 1440) {
      console.log(`  📊 Build is ${(ageMinutes / 60).toFixed(1)} hours old`);
    } else {
      console.log(`  ⚠️  Build is ${(ageMinutes / 1440).toFixed(1)} days old (consider rebuilding)`);
    }
    
    healthScore++;
  } catch (error) {
    console.log('  ❌ Server not built - run: npm run build');
  }
}

async function testBasicQuery() {
  console.log('\n🧪 Basic Query Test:');
  totalChecks++;
  
  try {
    const { explorePatternsTool } = await import('./dist/tools/explore-patterns.js');
    
    const result = await explorePatternsTool({
      core_concept: 'test query',
      current_hook: 'test hook',
      frame: 'test frame',
      exploration_depth: 1,
      min_performance: 1.0
    });
    
    const response = JSON.parse(result.content[0].text);
    
    if (response.stats && response.stats.total_videos_found >= 0) {
      console.log('  ✅ Basic query executed successfully');
      console.log(`  📊 Found ${response.stats.total_videos_found} videos`);
      healthScore++;
    }
  } catch (error) {
    console.log(`  ❌ Query test failed: ${error.message}`);
  }
}

// Run all checks
async function runHealthCheck() {
  const startTime = Date.now();
  
  await checkEnvironment();
  await checkSupabase();
  await checkPinecone();
  await checkOpenAI();
  await checkBuildStatus();
  await testBasicQuery();
  
  const duration = Date.now() - startTime;
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('HEALTH CHECK SUMMARY');
  console.log('=' .repeat(60));
  
  const percentage = (healthScore / totalChecks) * 100;
  const status = percentage === 100 ? '🟢 HEALTHY' : 
                  percentage >= 80 ? '🟡 MOSTLY HEALTHY' :
                  percentage >= 50 ? '🟠 DEGRADED' :
                  '🔴 UNHEALTHY';
  
  console.log(`Status: ${status}`);
  console.log(`Score: ${healthScore}/${totalChecks} checks passed (${percentage.toFixed(0)}%)`);
  console.log(`Duration: ${duration}ms`);
  
  if (healthScore < totalChecks) {
    console.log('\n📋 Action Items:');
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.log('  1. Add missing environment variables to ../.env');
    }
    if (healthScore < totalChecks - 1) {
      console.log('  2. Check API keys and connection settings');
    }
    console.log('  3. Run: npm run build');
    console.log('  4. See SETUP.md for detailed instructions');
  } else {
    console.log('\n✅ MCP Server is ready to use!');
    console.log('Next steps:');
    console.log('  1. Run comprehensive tests: node test-suite.js');
    console.log('  2. Configure Claude Desktop (see SETUP.md)');
  }
  
  process.exit(healthScore === totalChecks ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Fatal error during health check:', error);
  process.exit(1);
});

// Run
runHealthCheck();