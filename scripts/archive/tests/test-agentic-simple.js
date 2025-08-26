#!/usr/bin/env node

/**
 * SIMPLE TEST FOR AGENTIC MODE
 * Run this after applying the SQL fix
 */

// Load environment variables
require('dotenv').config();

const TEST_VIDEO_ID = '1lJJZ-KXj0I'; // A real video from your database

async function testAgentic() {
  console.log('\n=== TESTING AGENTIC MODE ===\n');
  
  // Test payload with 3-minute timeout
  const payload = {
    videoId: TEST_VIDEO_ID,
    mode: 'agentic',
    options: {
      maxTokens: 200000,
      maxToolCalls: 100,
      maxFanouts: 5,
      maxValidations: 20,
      maxDurationMs: 180000,  // 3 minutes
      timeoutMs: 180000       // 3 minutes
    }
  };
  
  console.log('📤 Sending request with 3-minute timeout...');
  console.log('Payload:', JSON.stringify(payload, null, 2));
  
  const startTime = Date.now();
  
  try {
    const response = await fetch('http://localhost:3000/api/idea-heist/agentic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    const duration = (Date.now() - startTime) / 1000;
    
    console.log(`\n⏱️  Completed in ${duration.toFixed(1)} seconds\n`);
    
    if (response.ok && data.success) {
      console.log('✅ SUCCESS!');
      console.log('\n📊 Pattern discovered:');
      console.log('   Statement:', data.pattern?.statement);
      console.log('   Confidence:', data.pattern?.confidence);
      console.log('   Validations:', data.pattern?.validations);
      
      console.log('\n💰 Budget usage:');
      console.log('   Tokens:', data.budgetUsage?.tokens);
      console.log('   Tool calls:', data.budgetUsage?.toolCalls);
      console.log('   Total cost: $', data.budgetUsage?.costs?.total?.toFixed(4));
      
      console.log('\n📈 Metrics:');
      console.log('   Mode:', data.mode);
      console.log('   Fallback used:', data.fallbackUsed);
      console.log('   Model switches:', data.metrics?.modelSwitches);
      
      // Check database
      console.log('\n🗄️  Checking database storage...');
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      const { data: patterns, error } = await supabase
        .from('patterns')
        .select('*')
        .eq('video_id', TEST_VIDEO_ID)
        .eq('pattern_type', 'agentic')
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (patterns && patterns.length > 0) {
        console.log('✅ Pattern successfully stored in database!');
        console.log('   Pattern ID:', patterns[0].id);
        console.log('   Created at:', patterns[0].created_at);
      } else {
        console.log('⚠️  Pattern not found in database');
        if (error) console.log('   Error:', error.message);
      }
      
    } else {
      console.log('❌ FAILED!');
      console.log('Error:', data.error);
      console.log('Details:', data.details);
      
      // Show budget usage even on failure
      if (data.budgetUsage) {
        console.log('\n💰 Budget usage before failure:');
        console.log('   Tokens:', data.budgetUsage?.tokens);
        console.log('   Tool calls:', data.budgetUsage?.toolCalls);
        console.log('   Duration:', data.budgetUsage?.durationMs, 'ms');
      }
    }
    
  } catch (error) {
    console.log('❌ Request failed:', error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
}

// Check environment
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.log('❌ Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

// Run test
testAgentic().catch(console.error);