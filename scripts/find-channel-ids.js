/**
 * Helper script to find YouTube channel IDs for research channels
 * Run: node scripts/find-channel-ids.js
 */

const channels = [
  'Ben Azelart',
  'Ryan Trahan', 
  'Simon Squibb',
  'BENOFTHEWEEK',
  'Drew Dirksen',
  'Patrick Zeinali',
  'DavidMC',
  'iNerdSome',
  'Joshua Weissman',
  'SWI Fence',
  'Patrick Cc:',
  'The Angry Explainer',
  'Quadrant',
  'FreestyleMoba',
  'Addie Bowley',
  'Car Care Clues',
  'Angelia Mor',
  'Dylan',
  'Vincent Chan',
  'The Chandler',
  'Make With Miles',
  'Andraz Egart',
  'No The Robot',
  'Practical Engineering',
  'Nikas Rezepte',
  'Shop Nation',
  'The Kelley\'s Country Life',
  'Geek Detour',
  'Colin and Samir'
];

async function findChannelIds() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('YOUTUBE_API_KEY not found in environment');
    return;
  }

  console.log('🔍 Finding channel IDs for research channels...\n');
  console.log('// Add these to manualChannelIds mapping:');
  console.log('const manualChannelIds: Record<string, string> = {');
  console.log('  \'Fix This Build That\': \'UCHYSw4XKO_q1GaChw5pxa-w\',');
  console.log('  \'wittworks\': \'UCGhyz7J9HmS0GT8Y_BR_crA\',');

  for (const channelName of channels) {
    try {
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(channelName)}&maxResults=1&key=${apiKey}`;
      const response = await fetch(searchUrl);
      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const channelId = data.items[0].id.channelId;
        const title = data.items[0].snippet.title;
        console.log(`  '${channelName}': '${channelId}', // ${title}`);
      } else {
        console.log(`  // ❌ '${channelName}': 'NOT_FOUND',`);
      }
      
      // Rate limit: 1 request per second
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.log(`  // ❌ '${channelName}': 'ERROR',`);
    }
  }
  
  console.log('};');
  console.log(`\n🔢 API calls used: ${channels.length} (100 units each)`);
  console.log('💰 Total cost: ~' + (channels.length * 100) + ' API units');
}

findChannelIds().catch(console.error);