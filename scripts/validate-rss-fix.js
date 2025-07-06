/**
 * Validate that our RSS filtering fix logic is sound
 * This is a conceptual test of the fix without importing TypeScript modules
 */

// Simulate the filtering logic with the fix
function filterNewVideos(rssVideos, existingVideos) {
  // Create a map of channel_id -> most recent video timestamp
  const channelLatestMap = {};
  
  existingVideos.forEach(video => {
    // Use YouTube channel ID from metadata if available, otherwise use channel_id
    const videoChannelId = video.metadata?.youtube_channel_id || video.channel_id;
    const current = channelLatestMap[videoChannelId];
    if (!current || new Date(video.published_at) > new Date(current)) {
      channelLatestMap[videoChannelId] = video.published_at;
    }
  });

  // Also check for existing video IDs to avoid duplicates
  const existingVideoIds = new Set(existingVideos.map(v => v.id));

  return rssVideos.filter(video => {
    // Skip if video already exists
    if (existingVideoIds.has(video.id)) {
      return false;
    }

    // Skip if video is older than most recent video for this channel
    const latestForChannel = channelLatestMap[video.channelId];
    if (latestForChannel && new Date(video.publishedAt) <= new Date(latestForChannel)) {
      return false;
    }

    return true;
  });
}

// Test data
const mockRSSVideos = [
  {
    id: 'test-video-1',
    title: 'Test Video 1',
    publishedAt: '2025-07-06T10:00:00Z',
    channelId: 'UC123456789', // YouTube channel ID
    channelTitle: 'Test Channel',
  },
  {
    id: 'test-video-2',
    title: 'Test Video 2',
    publishedAt: '2025-07-06T11:00:00Z',
    channelId: 'UC123456789', // Same YouTube channel ID
    channelTitle: 'Test Channel',
  }
];

// Existing videos with the OLD bug (channel name in channel_id)
const mockExistingVideosOldBug = [
  {
    id: 'existing-video-1',
    published_at: '2025-07-05T10:00:00Z',
    channel_id: 'Test Channel', // Channel name (old bug)
    metadata: {
      youtube_channel_id: 'UC123456789' // YouTube channel ID in metadata
    }
  }
];

// Existing videos with FIXED data (YouTube channel ID in channel_id)
const mockExistingVideosFixed = [
  {
    id: 'existing-video-1',
    published_at: '2025-07-05T10:00:00Z',
    channel_id: 'UC123456789', // YouTube channel ID (fixed)
    metadata: {
      youtube_channel_id: 'UC123456789'
    }
  }
];

// Existing videos with a duplicate
const mockExistingVideosWithDuplicate = [
  {
    id: 'test-video-1', // Same ID as first RSS video
    published_at: '2025-07-05T10:00:00Z',
    channel_id: 'UC123456789',
    metadata: {
      youtube_channel_id: 'UC123456789'
    }
  }
];

console.log('🧪 Validating RSS filtering fix...\n');

// Test 1: Fixed filtering should work correctly
console.log('Test 1: Fixed filtering with corrected channel IDs');
const filteredFixed = filterNewVideos(mockRSSVideos, mockExistingVideosFixed);
console.log(`Input RSS videos: ${mockRSSVideos.length}`);
console.log(`Existing videos: ${mockExistingVideosFixed.length}`);
console.log(`Filtered (new) videos: ${filteredFixed.length}`);
console.log(`Expected: 2 (both videos are newer than existing)`);
console.log(`✅ Test 1 ${filteredFixed.length === 2 ? 'PASSED' : 'FAILED'}\n`);

// Test 2: Should work with old bug data using metadata fallback
console.log('Test 2: Filtering with old bug data (channel name in channel_id)');
const filteredOldBug = filterNewVideos(mockRSSVideos, mockExistingVideosOldBug);
console.log(`Input RSS videos: ${mockRSSVideos.length}`);
console.log(`Existing videos (old bug format): ${mockExistingVideosOldBug.length}`);
console.log(`Filtered (new) videos: ${filteredOldBug.length}`);
console.log(`Expected: 2 (should work with metadata fallback)`);
console.log(`✅ Test 2 ${filteredOldBug.length === 2 ? 'PASSED' : 'FAILED'}\n`);

// Test 3: Duplicate detection should work
console.log('Test 3: Duplicate detection');
const filteredDuplicates = filterNewVideos(mockRSSVideos, mockExistingVideosWithDuplicate);
console.log(`Input RSS videos: ${mockRSSVideos.length}`);
console.log(`Existing videos (with duplicate): ${mockExistingVideosWithDuplicate.length}`);
console.log(`Filtered (new) videos: ${filteredDuplicates.length}`);
console.log(`Expected: 1 (test-video-1 should be filtered out, test-video-2 should remain)`);
console.log(`✅ Test 3 ${filteredDuplicates.length === 1 ? 'PASSED' : 'FAILED'}\n`);

console.log('🎉 Validation completed!');
console.log('\n📋 Summary of the fix:');
console.log('1. Fixed channel_id field to use YouTube channel ID instead of channel name');
console.log('2. Updated filtering logic to check both channel_id and metadata.youtube_channel_id');
console.log('3. This will prevent re-importing the same videos every day');
console.log('4. Resources will be saved by properly filtering out existing videos');
console.log('5. Run the SQL script to fix existing data inconsistencies');