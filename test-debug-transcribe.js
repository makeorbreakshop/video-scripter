// Debug test for transcript fetching

async function debugTranscript() {
  const videoId = 'dQw4w9WgXcQ';
  
  console.log(`🎬 Fetching transcript for video: ${videoId}`);
  
  // Step 1: Fetch the video page to get caption tracks
  const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
  const videoPageHtml = await videoPageResponse.text();
  
  // Check if we can find caption tracks
  const captionTracksMatch = videoPageHtml.match(/"captionTracks":\[(.*?)\]/);
  
  if (captionTracksMatch) {
    console.log('✅ Found caption tracks in HTML');
    
    try {
      const captionTracksData = JSON.parse(`[${captionTracksMatch[1]}]`);
      console.log(`📝 Number of tracks: ${captionTracksData.length}`);
      
      if (captionTracksData.length > 0) {
        console.log('\n📚 Available tracks:');
        captionTracksData.forEach((track, i) => {
          console.log(`  ${i + 1}. Language: ${track.languageCode}, Name: ${track.name?.simpleText || 'Auto-generated'}, Kind: ${track.kind || 'manual'}`);
        });
        
        // Select English track
        const selectedTrack = captionTracksData.find(t => t.languageCode === 'en') || captionTracksData[0];
        console.log(`\n🎯 Selected track: ${selectedTrack.languageCode}`);
        console.log(`📍 Track URL: ${selectedTrack.baseUrl.substring(0, 100)}...`);
        
        // Fetch the transcript
        const transcriptResponse = await fetch(selectedTrack.baseUrl);
        const transcriptXml = await transcriptResponse.text();
        
        console.log(`\n📄 XML Response length: ${transcriptXml.length} characters`);
        console.log('🔍 First 500 chars of XML:');
        console.log(transcriptXml.substring(0, 500));
        
        // Try to parse segments
        const textSegments = transcriptXml.match(/<text[^>]*>(.*?)<\/text>/g) || [];
        console.log(`\n💬 Found ${textSegments.length} text segments`);
        
        if (textSegments.length > 0) {
          console.log('\n🎯 First 3 segments (raw):');
          textSegments.slice(0, 3).forEach((seg, i) => {
            console.log(`  ${i + 1}. ${seg}`);
          });
        }
      }
    } catch (error) {
      console.error('❌ Error parsing caption tracks:', error.message);
      console.log('Raw match:', captionTracksMatch[1].substring(0, 500));
    }
  } else {
    console.log('❌ No caption tracks found in HTML');
    console.log('🔍 Checking for alternative patterns...');
    
    // Check if video exists
    if (videoPageHtml.includes('Video unavailable')) {
      console.log('❌ Video is unavailable');
    } else {
      console.log('✅ Video page loaded successfully');
      // Try alternative pattern
      const altPattern = videoPageHtml.match(/"captions".*?"playerCaptionsTracklistRenderer".*?"captionTracks":\[(.*?)\]/s);
      if (altPattern) {
        console.log('✅ Found captions with alternative pattern');
      }
    }
  }
}

debugTranscript().catch(console.error);