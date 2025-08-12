#!/usr/bin/env node

import { config } from 'dotenv';
config();

const payload = {
  videoId: 'Vq9vDkaAzc8',
  mode: 'agentic',
  options: {
    maxTokens: 200000,
    maxToolCalls: 100,
    maxFanouts: 5,
    maxValidations: 20,
    maxDurationMs: 180000,
    timeoutMs: 180000
  }
};

console.log('Testing agentic API directly...\n');

fetch('http://localhost:3000/api/idea-heist/agentic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(res => res.json())
.then(data => {
  console.log('Full API Response:');
  console.log(JSON.stringify(data, null, 2));
  
  if (data.success) {
    console.log('\n✅ Pattern discovery successful!');
    console.log('Statement:', data.pattern?.statement);
    console.log('Confidence:', data.pattern?.confidence);
    
    // Now check database
    import('@supabase/supabase-js').then(({ createClient }) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Try to manually insert the pattern
      console.log('\nAttempting manual database insert...');
      
      const patternData = {
        video_id: 'Vq9vDkaAzc8',
        confidence: data.pattern?.confidence,
        statement: data.pattern?.statement,
        evidence: data.pattern?.evidence || [],
        validations: data.pattern?.validations,
        mode: data.mode,
        fallbackUsed: data.fallbackUsed,
        metrics: data.metrics,
        budgetUsage: data.budgetUsage
      };
      
      supabase
        .from('patterns')
        .insert({
          video_id: 'Vq9vDkaAzc8',
          pattern_type: 'agentic_test',
          pattern_data: patternData,
          confidence: data.pattern?.confidence,
          statement: data.pattern?.statement,
          created_at: new Date().toISOString()
        })
        .then(({ data: insertData, error }) => {
          if (error) {
            console.log('❌ Insert failed:', error);
          } else {
            console.log('✅ Manual insert successful:', insertData);
          }
        });
    });
  }
})
.catch(err => console.error('Error:', err));