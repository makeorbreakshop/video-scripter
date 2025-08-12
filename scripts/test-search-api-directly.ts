#!/usr/bin/env npx tsx
/**
 * Test search-titles API directly
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testSearchAPI() {
  console.log('\n🔍 TESTING SEARCH-TITLES API DIRECTLY\n');
  
  const tests = [
    {
      name: 'Basic search - no filters',
      payload: {
        query: 'satisfying',
        top_k: 5
      }
    },
    {
      name: 'Search with lower score threshold',
      payload: {
        query: 'mechanical keyboard',
        top_k: 5,
        min_score: 0.2
      }
    },
    {
      name: 'Search without any filters',
      payload: {
        query: 'oddly satisfying',
        filters: {},
        top_k: 10
      }
    }
  ];
  
  for (const test of tests) {
    console.log(`\n📝 Test: ${test.name}`);
    console.log(`Payload: ${JSON.stringify(test.payload, null, 2)}`);
    
    try {
      const response = await fetch('http://localhost:3000/api/tools/search-titles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(test.payload)
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Success!`);
        console.log(`Results: ${data.data.results.length}`);
        
        if (data.data.results.length > 0) {
          console.log('First 3 results:');
          data.data.results.slice(0, 3).forEach((r: any, i: number) => {
            console.log(`  ${i + 1}. ${r.video_id} (score: ${r.similarity_score.toFixed(3)})`);
          });
        } else {
          console.log('❌ No results returned!');
        }
      } else {
        console.log(`❌ Error: ${data.error?.message || 'Unknown error'}`);
      }
      
    } catch (error: any) {
      console.log(`❌ Request failed: ${error.message}`);
    }
  }
}

testSearchAPI();