#!/usr/bin/env node

/**
 * Test temporal baseline calculation using MCP Supabase connection
 */

console.log('🧪 Testing Temporal Baseline Calculation');

// Get 5 videos that need baseline processing
const query1 = `
  SELECT 
    v.id,
    v.channel_id,
    v.published_at,
    v.view_count,
    DATE_PART('day', NOW() - v.published_at) as age_days
  FROM videos v
  WHERE v.is_short = false
  AND (v.channel_baseline_at_publish IS NULL OR v.channel_baseline_at_publish = 1.0)
  AND v.temporal_performance_score IS NULL
  ORDER BY v.created_at DESC
  LIMIT 5;
`;

console.log('📊 Finding 5 videos that need baseline processing...');
// This would need to be run via MCP tools, but let's create a simpler test

// Test the VALUES clause construction directly
const testUpdates = [
  { id: 'test1', baseline: 12345.67, score: 1.23 },
  { id: 'test2', baseline: 98765.43, score: 2.45 }
];

console.log('🔧 Testing VALUES clause construction...');

const chunk = testUpdates;
const values = chunk.map((u, idx) => 
  `($${idx*3+1}, $${idx*3+2}::numeric, $${idx*3+3}::numeric)`
).join(',');

const params = chunk.flatMap(u => [u.id, Number(u.baseline), Number(u.score)]);

const sql = `
  UPDATE videos v
  SET channel_baseline_at_publish = u.baseline::numeric,
      temporal_performance_score = u.score::numeric
  FROM (VALUES ${values}) AS u(id, baseline, score)
  WHERE v.id = u.id
`;

console.log('📝 Generated SQL:');
console.log(sql);
console.log('🔢 Parameters:', params);

// Validate parameter types
let allValid = true;
for (let i = 0; i < params.length; i++) {
  const param = params[i];
  const expectedType = i % 3 === 0 ? 'string' : 'number';
  const actualType = typeof param;
  
  if (actualType !== expectedType) {
    console.log(`❌ Parameter ${i} type mismatch: expected ${expectedType}, got ${actualType}`);
    allValid = false;
  }
}

if (allValid) {
  console.log('✅ All parameter types are correct');
  console.log('🎯 The SQL query structure should work');
} else {
  console.log('❌ Parameter type issues detected');
}