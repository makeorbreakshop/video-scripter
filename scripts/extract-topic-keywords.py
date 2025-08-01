#!/usr/bin/env python3
"""Extract topic keywords from saved BERTopic model"""

from bertopic import BERTopic
import json

# Load the model
print("Loading BERTopic model...")
model = BERTopic.load("bertopic_model_smart_20250801_131447")

# Get all topics
topics = model.get_topics()
print(f"Found {len(topics)} topics")

# Extract keywords for each topic
topic_keywords = {}
for topic_id in topics:
    if topic_id != -1:  # Skip outlier topic
        # Get top 10 words for this topic
        words = model.get_topic(topic_id)
        topic_keywords[topic_id] = {
            'id': topic_id,
            'keywords': [word for word, score in words[:10]],
            'top_words': ', '.join([word for word, score in words[:5]])
        }

# Save to file
output = {
    'total_topics': len(topic_keywords),
    'topics': topic_keywords
}

with open('bertopic_keywords.json', 'w') as f:
    json.dump(output, f, indent=2)

print(f"Saved keywords for {len(topic_keywords)} topics to bertopic_keywords.json")

# Show sample
print("\nSample topics:")
for i, (topic_id, info) in enumerate(list(topic_keywords.items())[:10]):
    print(f"Topic {topic_id}: {info['top_words']}")