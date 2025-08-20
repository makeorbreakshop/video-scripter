import dotenv from 'dotenv';
dotenv.config();

async function testYouTubeChannelAPI() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  
  if (!apiKey) {
    console.error('Missing YOUTUBE_API_KEY in environment variables');
    process.exit(1);
  }

  // Test with "I Like To Make Stuff" channel
  const testChannelId = 'UC6x7GwJxuoABSosgVXDYtTw';
  
  // Request all available parts
  const parts = [
    'snippet',
    'contentDetails', 
    'statistics',
    'topicDetails',
    'status',
    'brandingSettings',
    'localizations'
  ].join(',');
  
  const url = `https://www.googleapis.com/youtube/v3/channels?` + 
    `part=${parts}&` +
    `id=${testChannelId}&` +
    `key=${apiKey}`;

  try {
    console.log('Fetching channel data from YouTube API...\n');
    console.log('Channel ID:', testChannelId);
    console.log('Requested parts:', parts);
    console.log('\n-------------------------------------------\n');
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error('API Error:', data.error);
      return;
    }
    
    if (data.items && data.items.length > 0) {
      const channel = data.items[0];
      
      // Pretty print the entire response
      console.log('FULL API RESPONSE:');
      console.log(JSON.stringify(channel, null, 2));
      
      console.log('\n-------------------------------------------\n');
      console.log('SUMMARY OF AVAILABLE DATA:\n');
      
      // Extract key fields
      if (channel.snippet) {
        console.log('SNIPPET:');
        console.log('  - title:', channel.snippet.title);
        console.log('  - description:', channel.snippet.description?.substring(0, 100) + '...');
        console.log('  - customUrl:', channel.snippet.customUrl);
        console.log('  - publishedAt:', channel.snippet.publishedAt);
        console.log('  - country:', channel.snippet.country);
        console.log('  - defaultLanguage:', channel.snippet.defaultLanguage);
        console.log('  - thumbnails available:', Object.keys(channel.snippet.thumbnails || {}));
      }
      
      if (channel.statistics) {
        console.log('\nSTATISTICS:');
        console.log('  - viewCount:', channel.statistics.viewCount);
        console.log('  - subscriberCount:', channel.statistics.subscriberCount);
        console.log('  - videoCount:', channel.statistics.videoCount);
        console.log('  - hiddenSubscriberCount:', channel.statistics.hiddenSubscriberCount);
      }
      
      if (channel.contentDetails) {
        console.log('\nCONTENT DETAILS:');
        console.log('  - relatedPlaylists:', channel.contentDetails.relatedPlaylists);
      }
      
      if (channel.topicDetails) {
        console.log('\nTOPIC DETAILS:');
        console.log('  - topicIds:', channel.topicDetails.topicIds);
        console.log('  - topicCategories:', channel.topicDetails.topicCategories);
      }
      
      if (channel.status) {
        console.log('\nSTATUS:');
        console.log('  - privacyStatus:', channel.status.privacyStatus);
        console.log('  - isLinked:', channel.status.isLinked);
        console.log('  - longUploadsStatus:', channel.status.longUploadsStatus);
        console.log('  - madeForKids:', channel.status.madeForKids);
      }
      
      if (channel.brandingSettings) {
        console.log('\nBRANDING SETTINGS:');
        if (channel.brandingSettings.channel) {
          console.log('  - title:', channel.brandingSettings.channel.title);
          console.log('  - description:', channel.brandingSettings.channel.description?.substring(0, 100) + '...');
          console.log('  - keywords:', channel.brandingSettings.channel.keywords?.substring(0, 100) + '...');
          console.log('  - trackingAnalyticsAccountId:', channel.brandingSettings.channel.trackingAnalyticsAccountId);
          console.log('  - unsubscribedTrailer:', channel.brandingSettings.channel.unsubscribedTrailer);
        }
        if (channel.brandingSettings.image) {
          console.log('  - banner image URL:', channel.brandingSettings.image.bannerExternalUrl);
        }
      }
      
      if (channel.localizations) {
        console.log('\nLOCALIZATIONS:');
        console.log('  - Available languages:', Object.keys(channel.localizations || {}));
      }
      
    } else {
      console.log('No channel found');
    }
    
  } catch (error) {
    console.error('Error fetching channel:', error);
  }
}

testYouTubeChannelAPI();