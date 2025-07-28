#!/usr/bin/env python3
"""
Prepare data for Claude API naming with sample titles
"""
import json
import random

print("Preparing data for Claude API naming")
print("=" * 60)

# Load data
with open('topic_keywords_final.json', 'r') as f:
    topics = json.load(f)

with open('bertopic_results_final.json', 'r') as f:
    results = json.load(f)

# Create topic to videos mapping
topic_videos = {}
for assignment in results['assignments']:
    topic_id = assignment['topic']
    if topic_id not in topic_videos:
        topic_videos[topic_id] = []
    topic_videos[topic_id].append(assignment)

# Prepare enriched topic data
enriched_topics = []

for topic in topics[:100]:  # First 100 for testing
    topic_id = topic['topic_id']
    
    # Get sample videos
    videos_in_topic = topic_videos.get(topic_id, [])
    
    # Sample up to 10 random titles
    sample_size = min(10, len(videos_in_topic))
    sample_videos = random.sample(videos_in_topic, sample_size) if videos_in_topic else []
    
    enriched_topic = {
        'topic_id': topic_id,
        'video_count': topic['size'],
        'keywords': topic['keywords'],
        'sample_titles': [v['title'] for v in sample_videos]
    }
    
    enriched_topics.append(enriched_topic)

# Save for Claude API processing
with open('topics_for_claude_naming.json', 'w') as f:
    json.dump({
        'total_topics': len(topics),
        'included_topics': len(enriched_topics),
        'topics': enriched_topics
    }, f, indent=2)

print(f"✅ Prepared {len(enriched_topics)} topics with sample titles")
print("Saved to: topics_for_claude_naming.json")

# Show examples
print("\n📝 Sample topics with titles:")
for topic in enriched_topics[:5]:
    print(f"\nTopic {topic['topic_id']} ({topic['video_count']} videos)")
    print(f"Keywords: {', '.join(topic['keywords'][:5])}")
    print("Sample titles:")
    for title in topic['sample_titles'][:3]:
        print(f"  - {title}")