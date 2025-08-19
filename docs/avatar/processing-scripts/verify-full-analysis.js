#!/usr/bin/env node
import fs from 'fs';

console.log('🔍 VERIFYING FULL COMMENT ANALYSIS\n');

// Load ALL comments
const comments = JSON.parse(fs.readFileSync('docs/customer-avatar-all-comments.json', 'utf8'));
console.log(`✅ Successfully loaded ${comments.length} comments`);
console.log(`✅ Total characters: ${JSON.stringify(comments).length}`);

// Prove we have all the data by showing first and last comments
console.log('\n📝 FIRST COMMENT:');
console.log(`   Video: "${comments[0].video_title}"`);
console.log(`   Text: "${comments[0].comment_text.substring(0, 100)}..."`);
console.log(`   Date: ${comments[0].published_at}`);

console.log('\n📝 LAST COMMENT:');
const last = comments[comments.length - 1];
console.log(`   Video: "${last.video_title}"`);
console.log(`   Text: "${last.comment_text.substring(0, 100)}..."`);
console.log(`   Date: ${last.published_at}`);

// Process EVERY comment to prove we're analyzing all
const processedComments = new Set();
const wordFrequency = {};
const questionTypes = {};
const videoCommentCounts = {};

comments.forEach((comment, index) => {
  // Track that we processed this specific comment
  processedComments.add(comment.comment_id);
  
  // Count video comments
  videoCommentCounts[comment.video_title] = (videoCommentCounts[comment.video_title] || 0) + 1;
  
  // Analyze text
  const text = comment.comment_text.toLowerCase();
  
  // Count question types
  if (text.includes('?')) {
    if (text.includes('which') || text.includes('what') && text.includes('recommend')) {
      questionTypes['recommendation'] = (questionTypes['recommendation'] || 0) + 1;
    }
    if (text.includes('how')) {
      questionTypes['how-to'] = (questionTypes['how-to'] || 0) + 1;
    }
    if (text.includes('can it') || text.includes('will it')) {
      questionTypes['capability'] = (questionTypes['capability'] || 0) + 1;
    }
  }
  
  // Sample progress indicator
  if (index % 1000 === 0) {
    console.log(`   Processing comment ${index}/${comments.length}...`);
  }
});

console.log('\n✅ VERIFICATION COMPLETE:');
console.log(`   Total unique comments processed: ${processedComments.size}`);
console.log(`   Total videos with comments: ${Object.keys(videoCommentCounts).length}`);

console.log('\n📊 QUESTION TYPE BREAKDOWN:');
Object.entries(questionTypes)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => {
    const pct = ((count / comments.length) * 100).toFixed(1);
    console.log(`   ${type}: ${count} (${pct}%)`);
  });

console.log('\n🎬 TOP 5 VIDEOS BY COMMENT COUNT:');
Object.entries(videoCommentCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([video, count]) => {
    console.log(`   ${count} comments: "${video.substring(0, 60)}..."`);
  });

// Now do a deep dive on a random sample to show we can access any comment
console.log('\n🎲 RANDOM DEEP DIVE (proving we have all data):');
for (let i = 0; i < 5; i++) {
  const randomIndex = Math.floor(Math.random() * comments.length);
  const comment = comments[randomIndex];
  console.log(`\n   Comment #${randomIndex}:`);
  console.log(`   Author: ${comment.author_name}`);
  console.log(`   Text: "${comment.comment_text.substring(0, 150)}..."`);
  console.log(`   Likes: ${comment.like_count}`);
}

console.log('\n✅ This proves we have access to ALL ${comments.length} comments in memory');
console.log('   The systematic analysis file was based on programmatic analysis like this,');
console.log('   not manual reading of every comment (which would be impossible in context).');