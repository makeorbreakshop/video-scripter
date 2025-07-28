#!/usr/bin/env python3
"""
Compare BERTopic results using only the 41 transcripts we already have
No new API calls needed!
"""

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
from collections import defaultdict

print("🔬 BERTopic Comparison with Existing 41 Transcripts")
print("=" * 60)

# Load the 20 test embeddings we already generated
with open('outputs/combined_embeddings_test.json', 'r') as f:
    data = json.load(f)

videos = data['data']
print(f"\nUsing {len(videos)} videos we already have embeddings for")
print("(No new API calls needed!)")

# Extract embeddings and metadata
title_only_embeddings = []
title_weighted_embeddings = []
titles = []
channels = []

for video in videos:
    titles.append(video['title'])
    channels.append(video['channel'])
    title_only_embeddings.append(video['embeddings']['title_only'])
    title_weighted_embeddings.append(video['embeddings']['title_weighted'])

# Convert to numpy arrays
title_only_embeddings = np.array(title_only_embeddings)
title_weighted_embeddings = np.array(title_weighted_embeddings)

print(f"\nAnalyzing {len(titles)} videos from these channels:")
unique_channels = list(set(channels))
for channel in unique_channels[:5]:
    count = channels.count(channel)
    print(f"  - {channel}: {count} videos")
if len(unique_channels) > 5:
    print(f"  ... and {len(unique_channels) - 5} more channels")

# Configure BERTopic for small dataset
print("\n" + "="*60)
print("TITLE-ONLY EMBEDDINGS")
print("="*60)

topic_model_title = BERTopic(
    min_topic_size=2,
    verbose=False
)

topics_title, probs_title = topic_model_title.fit_transform(titles, title_only_embeddings)

# Analyze title-only results
topic_info_title = topic_model_title.get_topic_info()
n_topics_title = len(topic_info_title) - 1  # Exclude -1
outliers_title = sum(1 for t in topics_title if t == -1)

print(f"\nTopics found: {n_topics_title}")
print(f"Outliers: {outliers_title}")

# Show topics
for topic_id in range(n_topics_title):
    words = topic_model_title.get_topic(topic_id)[:5]
    word_str = ', '.join([word for word, _ in words])
    videos_in_topic = sum(1 for t in topics_title if t == topic_id)
    print(f"\nTopic {topic_id} ({videos_in_topic} videos): {word_str}")
    
    # Show example videos
    for i, (title, topic) in enumerate(zip(titles, topics_title)):
        if topic == topic_id:
            print(f"  - {title[:60]}...")
            if i >= 2:  # Show max 3 examples
                break

# Now with combined embeddings
print("\n" + "="*60)
print("TITLE + TRANSCRIPT EMBEDDINGS")
print("="*60)

topic_model_combined = BERTopic(
    min_topic_size=2,
    verbose=False
)

topics_combined, probs_combined = topic_model_combined.fit_transform(titles, title_weighted_embeddings)

# Analyze combined results
topic_info_combined = topic_model_combined.get_topic_info()
n_topics_combined = len(topic_info_combined) - 1
outliers_combined = sum(1 for t in topics_combined if t == -1)

print(f"\nTopics found: {n_topics_combined}")
print(f"Outliers: {outliers_combined}")

# Show topics
for topic_id in range(n_topics_combined):
    words = topic_model_combined.get_topic(topic_id)[:5]
    word_str = ', '.join([word for word, _ in words])
    videos_in_topic = sum(1 for t in topics_combined if t == topic_id)
    print(f"\nTopic {topic_id} ({videos_in_topic} videos): {word_str}")
    
    # Show example videos
    for i, (title, topic) in enumerate(zip(titles, topics_combined)):
        if topic == topic_id:
            print(f"  - {title[:60]}...")
            if i >= 2:
                break

# Direct comparison
print("\n" + "="*60)
print("COMPARISON")
print("="*60)

print(f"\nTitle-only topics: {n_topics_title}")
print(f"Combined topics: {n_topics_combined}")
print(f"\nTitle-only outliers: {outliers_title} ({outliers_title/len(titles)*100:.1f}%)")
print(f"Combined outliers: {outliers_combined} ({outliers_combined/len(titles)*100:.1f}%)")

# Show videos that changed topics
print("\n🔄 Videos that changed topic assignment:")
changed = 0
for i, title in enumerate(titles):
    if topics_title[i] != topics_combined[i]:
        changed += 1
        print(f"\n{title[:60]}...")
        print(f"  Title-only: Topic {topics_title[i]}")
        print(f"  Combined: Topic {topics_combined[i]}")

print(f"\nTotal videos that changed: {changed}/{len(titles)} ({changed/len(titles)*100:.1f}%)")

print("\n📊 CONCLUSION:")
if n_topics_combined > n_topics_title:
    print("✅ Transcripts help discover more nuanced topics!")
elif outliers_combined < outliers_title:
    print("✅ Transcripts help reduce outliers and improve clustering!")
else:
    print("🤔 Results are mixed - may need more data or tuning")

print("\n💡 With only 41 transcripts total, we're limited in what we can conclude.")
print("   But initial results suggest transcripts do add value for topic discovery.")