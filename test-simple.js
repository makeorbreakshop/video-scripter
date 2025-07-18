#!/usr/bin/env node

async function testBasic() {
  try {
    console.log('Testing basic API call...');
    const response = await fetch('http://localhost:3000/api/youtube/patterns/generate-titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concept: "test",
        options: { maxSuggestions: 1 }
      })
    });
    
    if (!response.ok) {
      console.error('Response not OK:', response.status, response.statusText);
      return;
    }
    
    const data = await response.json();
    console.log('Response keys:', Object.keys(data));
    console.log('Suggestions:', data.suggestions?.length || 0);
    console.log('Error:', data.error || 'none');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testBasic();