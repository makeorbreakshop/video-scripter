/**
 * Test with a unique search query
 */

const API_URL = 'http://localhost:3000/api/google-pse/search';

async function testNewSearch() {
  const uniqueQuery = `Robotics tutorial ${Date.now() % 1000}`;
  console.log(`Testing with query: "${uniqueQuery}"\n`);
  
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: uniqueQuery })
  });
  
  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

testNewSearch();