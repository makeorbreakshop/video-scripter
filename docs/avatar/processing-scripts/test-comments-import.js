// Test script to import comments from Make or Break Shop channel
import dotenv from 'dotenv';
dotenv.config();

const MAKE_OR_BREAK_SHOP_CHANNEL_ID = 'UCjWkNxpp3UHdEavpM_19--Q'; // Make or Break Shop channel

async function testCommentsImport() {
  try {
    console.log('Testing comment import for Make or Break Shop...');
    
    const response = await fetch('http://localhost:3000/api/youtube/comments/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channelId: MAKE_OR_BREAK_SHOP_CHANNEL_ID,
        channelName: 'Make or Break Shop',
        maxComments: 100 // Quick test with 100 comments
      }),
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Success!');
      console.log(`Imported ${result.imported} comments`);
      console.log(`From ${result.totalVideos} videos`);
    } else {
      console.log('❌ Error:', result.error);
      if (result.details) console.log('Details:', result.details);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testCommentsImport();