// Test script for the YouTube transcribe API

async function testTranscribeAPI() {
  const testVideos = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // Rick Astley - Never Gonna Give You Up (should have captions)
    'https://youtu.be/dQw4w9WgXcQ', // Same video, different URL format
  ];

  for (const videoUrl of testVideos) {
    console.log(`\n📺 Testing with URL: ${videoUrl}`);
    console.log('='.repeat(60));
    
    try {
      const response = await fetch('http://localhost:3000/api/youtube/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: extractVideoId(videoUrl),
          includeChapters: true
        }),
      });

      console.log(`📊 Response Status: ${response.status}`);
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Success!');
        console.log(`📝 Video Title: ${data.metadata?.title || 'N/A'}`);
        console.log(`👤 Channel: ${data.metadata?.channel || 'N/A'}`);
        console.log(`👁️ Views: ${data.metadata?.viewCount?.toLocaleString() || 'N/A'}`);
        console.log(`⏱️ Duration: ${formatDuration(data.metadata?.duration || 0)}`);
        console.log(`📅 Published: ${data.metadata?.publishedAt ? new Date(data.metadata.publishedAt).toLocaleDateString() : 'N/A'}`);
        console.log(`📖 Chapters Found: ${data.chapters?.length || 0}`);
        console.log(`💬 Transcript Segments: ${data.transcript?.length || 0}`);
        console.log(`📄 Full Text Length: ${data.fullText?.length || 0} characters`);
        
        if (data.chapters && data.chapters.length > 0) {
          console.log('\n📚 Chapter List:');
          data.chapters.forEach((ch, i) => {
            console.log(`  ${i + 1}. [${ch.formattedTime}] ${ch.title}`);
          });
        }
        
        if (data.transcript && data.transcript.length > 0) {
          console.log('\n🎯 First 3 transcript segments:');
          data.transcript.slice(0, 3).forEach((seg, i) => {
            console.log(`  ${i + 1}. [${formatTime(seg.start)}] "${seg.text.substring(0, 50)}..."`);
          });
        }
      } else {
        console.log('❌ Error:', data.error);
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

function formatTime(seconds) {
  return formatDuration(seconds);
}

// Run the test
console.log('🚀 Starting YouTube Transcribe API Tests');
console.log('='.repeat(60));
testTranscribeAPI().then(() => {
  console.log('\n✨ All tests completed!');
}).catch(error => {
  console.error('\n🚨 Test suite failed:', error);
});