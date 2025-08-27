// Test different approaches to fetch YouTube transcript

async function tryFetchTranscript() {
  const videoId = 'dQw4w9WgXcQ';
  
  // Try using youtube-transcript library approach
  console.log('🎯 Testing youtube-transcript library approach...\n');
  
  try {
    // First get the page
    const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const pageResponse = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    
    const html = await pageResponse.text();
    
    // Look for the caption URL in the page
    const captionRegex = /"captionTracks":\[(.*?)\]/;
    const match = html.match(captionRegex);
    
    if (match) {
      const tracks = JSON.parse('[' + match[1] + ']');
      console.log(`Found ${tracks.length} caption tracks`);
      
      // Get English track
      const englishTrack = tracks.find(t => t.languageCode === 'en' && !t.kind) || 
                          tracks.find(t => t.languageCode === 'en');
      
      if (englishTrack) {
        console.log('📝 Found English track');
        
        // Add format parameter to the URL
        const transcriptUrl = englishTrack.baseUrl + '&fmt=json3';
        console.log(`🔗 Fetching from: ${transcriptUrl.substring(0, 100)}...`);
        
        const transcriptResponse = await fetch(transcriptUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          }
        });
        
        const contentType = transcriptResponse.headers.get('content-type');
        console.log(`📄 Response content-type: ${contentType}`);
        console.log(`📊 Response status: ${transcriptResponse.status}`);
        
        if (transcriptResponse.ok) {
          const transcriptData = await transcriptResponse.text();
          console.log(`✅ Got transcript data: ${transcriptData.length} chars`);
          
          // Try to parse as JSON
          try {
            const jsonData = JSON.parse(transcriptData);
            console.log('✅ Successfully parsed as JSON');
            
            if (jsonData.events) {
              console.log(`📝 Found ${jsonData.events.length} events`);
              
              // Show first few segments
              const textEvents = jsonData.events.filter(e => e.segs);
              console.log(`💬 Found ${textEvents.length} text events`);
              
              if (textEvents.length > 0) {
                console.log('\n🎯 First 3 segments:');
                textEvents.slice(0, 3).forEach((event, i) => {
                  const text = event.segs.map(s => s.utf8).join('');
                  console.log(`  ${i + 1}. [${(event.tStartMs / 1000).toFixed(1)}s] "${text}"`);
                });
              }
            }
          } catch (e) {
            console.log('⚠️ Not JSON format, checking XML...');
            
            // Try XML parsing
            const textMatches = transcriptData.match(/<text[^>]*>(.*?)<\/text>/g) || [];
            console.log(`📝 Found ${textMatches.length} XML text elements`);
            
            if (textMatches.length > 0) {
              console.log('\n🎯 First 3 segments:');
              textMatches.slice(0, 3).forEach((match, i) => {
                console.log(`  ${i + 1}. ${match.substring(0, 100)}...`);
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

tryFetchTranscript().catch(console.error);