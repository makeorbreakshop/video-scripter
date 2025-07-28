#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from collections import defaultdict

def analyze_topics_and_summaries():
    print("📊 Analyzing LLM Summaries and Topic Assignments\n")
    
    # Load the data
    with open('llm_summary_embeddings.json', 'r') as f:
        data = json.load(f)
    
    videos = data['videos']
    combined_embeddings = np.array(data['embeddings']['title_plus_summary'])
    
    # Prepare texts
    titles_with_summaries = [f"{v['title']} | {v['summary']}" for v in videos]
    
    # Run BERTopic to get topic assignments
    topic_model = BERTopic(
        min_topic_size=5,
        verbose=False,
        calculate_probabilities=True,
        nr_topics="auto"
    )
    
    topics, probs = topic_model.fit_transform(
        titles_with_summaries,
        embeddings=combined_embeddings
    )
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    
    print("🏷️ TOPIC BREAKDOWN:\n")
    
    # Group videos by topic
    topic_videos = defaultdict(list)
    for i, topic in enumerate(topics):
        topic_videos[topic].append(i)
    
    # Show each topic with examples
    for topic_id in sorted(topic_videos.keys()):
        if topic_id == -1:
            continue  # Skip outliers
            
        # Get topic keywords
        keywords = [word for word, _ in topic_model.get_topic(topic_id)[:8]]
        
        # Get topic info
        topic_row = topic_info[topic_info['Topic'] == topic_id].iloc[0]
        count = topic_row['Count']
        
        print(f"\n{'='*80}")
        print(f"📌 TOPIC {topic_id} ({count} videos)")
        print(f"Keywords: {', '.join(keywords)}")
        print(f"\nSample videos:")
        
        # Show up to 5 examples
        for idx in topic_videos[topic_id][:5]:
            video = videos[idx]
            print(f"\n  • Title: {video['title']}")
            print(f"    Channel: {video['channel']}")
            print(f"    Summary: {video['summary']}")
    
    # Analyze channels per topic
    print(f"\n\n{'='*80}")
    print("📺 CHANNEL DISTRIBUTION BY TOPIC:\n")
    
    for topic_id in sorted(topic_videos.keys()):
        if topic_id == -1:
            continue
            
        channel_counts = defaultdict(int)
        for idx in topic_videos[topic_id]:
            channel_counts[videos[idx]['channel']] += 1
        
        # Sort by count
        top_channels = sorted(channel_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        
        print(f"Topic {topic_id}:")
        for channel, count in top_channels:
            print(f"  - {channel}: {count} videos")
    
    # Show videos that were outliers in title-only but got categorized with summaries
    print(f"\n\n{'='*80}")
    print("🎯 SAMPLE LLM SUMMARIES (showing variety):\n")
    
    # Show diverse examples
    sample_indices = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150]
    
    for i in sample_indices:
        if i < len(videos):
            video = videos[i]
            topic = topics[i]
            print(f"\nVideo: \"{video['title'][:60]}...\"")
            print(f"Channel: {video['channel']}")
            print(f"Summary: {video['summary']}")
            print(f"Assigned to Topic {topic}")

if __name__ == "__main__":
    analyze_topics_and_summaries()