// Test Whisper transcription for YouTube videos

async function testWhisperTranscribe() {
  // Test with a short video (under 5 minutes)
  const testVideos = [
    {
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      description: 'Me at the zoo (19 seconds - first YouTube video)'
    },
    {
      url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',  
      description: 'Big Buck Bunny 60fps 4K (10 minutes)'
    }
  ];

  for (const video of testVideos) {
    console.log(`\n📺 Testing: ${video.description}`);
    console.log(`🔗 URL: ${video.url}`);
    console.log('='.repeat(60));
    
    const videoId = extractVideoId(video.url);
    if (!videoId) {
      console.log('❌ Could not extract video ID');
      continue;
    }

    try {
      console.log('⏳ Starting transcription (this may take a minute)...');
      const startTime = Date.now();
      
      const response = await fetch('http://localhost:3000/api/youtube/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: videoId,
          includeChapters: true
        }),
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`⏱️ Request completed in ${elapsed} seconds`);
      console.log(`📊 Response Status: ${response.status}`);
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Success!');
        console.log(`📝 Video Title: ${data.metadata?.title || 'N/A'}`);
        console.log(`👤 Channel: ${data.metadata?.channel || 'N/A'}`);
        console.log(`🗣️ Language: ${data.metadata?.language || 'N/A'}`);
        console.log(`⏱️ Duration: ${formatDuration(data.metadata?.duration || 0)}`);
        console.log(`🤖 Whisper Used: ${data.whisperUsed ? 'Yes' : 'No'}`);
        console.log(`📖 Chapters Found: ${data.chapters?.length || 0}`);
        console.log(`💬 Transcript Segments: ${data.transcript?.length || 0}`);
        console.log(`📄 Full Text Length: ${data.fullText?.length || 0} characters`);
        
        if (data.chapters && data.chapters.length > 0) {
          console.log('\n📚 Detected Chapters:');
          data.chapters.forEach((ch, i) => {
            console.log(`  ${i + 1}. [${ch.formattedTime}] ${ch.title}`);
          });
        }
        
        if (data.fullText) {
          console.log('\n📝 First 200 characters of transcript:');
          console.log(`  "${data.fullText.substring(0, 200)}..."`);
        }
      } else {
        console.log('❌ Error:', data.error);
        if (data.details) {
          console.log('📋 Details:', data.details);
        }
      }
    } catch (error) {
      console.error('🚨 Request failed:', error.message);
    }
  }
}

function extractVideoId(url) {
  const patterns = [
    /youtube\.com\/watch\?v=([^&]+)/,
    /youtu\.be\/([^?]+)/,
    /youtube\.com\/embed\/([^?]+)/,
    /youtube\.com\/v\/([^?]+)/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Run the test
console.log('🚀 Testing YouTube Whisper Transcription');
console.log('='.repeat(60));
testWhisperTranscribe().then(() => {
  console.log('\n✨ All tests completed!');
}).catch(error => {
  console.error('\n🚨 Test suite failed:', error);
});