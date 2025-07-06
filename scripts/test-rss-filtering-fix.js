/**
 * Test script to verify RSS filtering fix
 * This script tests the filterNewVideos function with the fixed logic
 */

const { filterNewVideos } = require('../lib/rss-channel-monitor');

// Mock data that represents the bug scenario
const mockRSSVideos = [
  {
    id: 'test-video-1',
    title: 'Test Video 1',
    description: 'Test description',
    publishedAt: '2025-07-06T10:00:00Z',
    channelId: 'UC123456789', // YouTube channel ID
    channelTitle: 'Test Channel',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    videoUrl: 'https://youtube.com/watch?v=test-video-1',
    updatedAt: '2025-07-06T10:00:00Z'
  },
  {
    id: 'test-video-2',
    title: 'Test Video 2',
    description: 'Test description',
    publishedAt: '2025-07-06T11:00:00Z',
    channelId: 'UC123456789', // Same YouTube channel ID
    channelTitle: 'Test Channel',
    thumbnailUrl: 'https://example.com/thumb.jpg',
    videoUrl: 'https://youtube.com/watch?v=test-video-2',
    updatedAt: '2025-07-06T11:00:00Z'
  }
];

// Mock existing videos from database - this represents the OLD bug state
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

// Mock existing videos from database - this represents the FIXED state
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

// Mock existing videos that include one of our test videos (duplicate scenario)
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

console.log('🧪 Testing RSS filtering fix...\n');

// Test 1: Fixed filtering should work correctly
console.log('Test 1: Fixed filtering with corrected channel IDs');
const filteredFixed = filterNewVideos(mockRSSVideos, mockExistingVideosFixed);
console.log(`Input RSS videos: ${mockRSSVideos.length}`);
console.log(`Existing videos: ${mockExistingVideosFixed.length}`);
console.log(`Filtered (new) videos: ${filteredFixed.length}`);
console.log(`Expected: 2 (both videos are newer than existing)`);
console.log(`✅ Test 1 ${filteredFixed.length === 2 ? 'PASSED' : 'FAILED'}\n`);

// Test 2: Filtering with old bug data (should still work now)
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

// Test 4: Timestamp filtering
console.log('Test 4: Timestamp filtering');
const mockNewerExisting = [
  {
    id: 'newer-video',
    published_at: '2025-07-07T10:00:00Z', // Newer than our RSS videos
    channel_id: 'UC123456789',
    metadata: {
      youtube_channel_id: 'UC123456789'
    }
  }
];
const filteredTimestamp = filterNewVideos(mockRSSVideos, mockNewerExisting);
console.log(`Input RSS videos: ${mockRSSVideos.length}`);
console.log(`Existing videos (newer): ${mockNewerExisting.length}`);
console.log(`Filtered (new) videos: ${filteredTimestamp.length}`);
console.log(`Expected: 0 (both RSS videos are older than existing)`);
console.log(`✅ Test 4 ${filteredTimestamp.length === 0 ? 'PASSED' : 'FAILED'}\n`);

console.log('🎉 All tests completed!');