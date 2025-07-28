#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
from collections import defaultdict

def analyze_real_videos_clustering():
    print("🔬 BERTopic Analysis: YOUR Actual Maker/DIY Content\n")
    
    # Load the data
    print("Loading embeddings data...")
    with open('real_videos_llm_embeddings.json', 'r') as f:
        data = json.load(f)
    
    videos = data['videos']
    title_embeddings = np.array(data['embeddings']['title_only'])
    combined_embeddings = np.array(data['embeddings']['title_plus_summary'])
    
    print(f"Loaded {len(videos)} videos with embeddings")
    print(f"Channels: 3D Printing Nerd ({sum(1 for v in videos if '3D Printing' in v['channel'])}), ")
    print(f"         Bourbon Moth ({sum(1 for v in videos if 'Bourbon' in v['channel'])})\n")
    
    # Show sample data
    print("Sample videos with summaries:")
    for i in range(min(5, len(videos))):
        print(f"\n{i+1}. {videos[i]['title'][:60]}...")
        print(f"   Channel: {videos[i]['channel']}")
        print(f"   Summary: {videos[i]['summary']}")
    
    print("\n" + "="*80 + "\n")
    
    # Prepare document lists
    titles_only = [v['title'] for v in videos]
    titles_with_summaries = [f"{v['title']} | {v['summary']}" for v in videos]
    
    # Run BERTopic on title-only
    print("🔬 Running BERTopic on TITLE-ONLY embeddings...")
    topic_model_title = BERTopic(
        min_topic_size=5,
        verbose=False,
        calculate_probabilities=True,
        nr_topics="auto"
    )
    
    topics_title, probs_title = topic_model_title.fit_transform(
        titles_only, 
        embeddings=title_embeddings
    )
    
    # Calculate metrics for title-only
    topic_info_title = topic_model_title.get_topic_info()
    num_topics_title = len([t for t in topic_info_title['Topic'] if t != -1])
    
    non_outlier_mask_title = np.array(topics_title) != -1
    if np.sum(non_outlier_mask_title) > 1:
        unique_topics = len(np.unique(np.array(topics_title)[non_outlier_mask_title]))
        if unique_topics > 1:
            silhouette_title = silhouette_score(
                title_embeddings[non_outlier_mask_title],
                np.array(topics_title)[non_outlier_mask_title]
            )
        else:
            silhouette_title = 0
    else:
        silhouette_title = 0
    
    outliers_title = np.sum(np.array(topics_title) == -1)
    
    print(f"\n✅ Title-only Results:")
    print(f"   Topics found: {num_topics_title}")
    print(f"   Silhouette score: {silhouette_title:.3f}")
    print(f"   Outliers: {outliers_title}/{len(topics_title)} ({outliers_title/len(topics_title)*100:.1f}%)")
    
    # Show top topics
    print("\n   Top topics (Title-only):")
    topic_count = 0
    for idx, row in topic_info_title.iterrows():
        if row['Topic'] != -1 and topic_count < 5:
            words = [word for word, _ in topic_model_title.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
            topic_count += 1
    
    print("\n" + "="*80 + "\n")
    
    # Run BERTopic on title+summary
    print("🔬 Running BERTopic on TITLE+SUMMARY embeddings...")
    topic_model_combined = BERTopic(
        min_topic_size=5,
        verbose=False,
        calculate_probabilities=True,
        nr_topics="auto"
    )
    
    topics_combined, probs_combined = topic_model_combined.fit_transform(
        titles_with_summaries,
        embeddings=combined_embeddings
    )
    
    # Calculate metrics for combined
    topic_info_combined = topic_model_combined.get_topic_info()
    num_topics_combined = len([t for t in topic_info_combined['Topic'] if t != -1])
    
    non_outlier_mask_combined = np.array(topics_combined) != -1
    if np.sum(non_outlier_mask_combined) > 1:
        unique_topics = len(np.unique(np.array(topics_combined)[non_outlier_mask_combined]))
        if unique_topics > 1:
            silhouette_combined = silhouette_score(
                combined_embeddings[non_outlier_mask_combined],
                np.array(topics_combined)[non_outlier_mask_combined]
            )
        else:
            silhouette_combined = 0
    else:
        silhouette_combined = 0
    
    outliers_combined = np.sum(np.array(topics_combined) == -1)
    
    print(f"\n✅ Title+Summary Results:")
    print(f"   Topics found: {num_topics_combined}")
    print(f"   Silhouette score: {silhouette_combined:.3f}")
    print(f"   Outliers: {outliers_combined}/{len(topics_combined)} ({outliers_combined/len(topics_combined)*100:.1f}%)")
    
    # Show top topics
    print("\n   Top topics (Title+Summary):")
    topic_count = 0
    for idx, row in topic_info_combined.iterrows():
        if row['Topic'] != -1 and topic_count < 5:
            words = [word for word, _ in topic_model_combined.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
            topic_count += 1
    
    print("\n" + "="*80 + "\n")
    
    # Detailed topic analysis
    print("📊 DETAILED TOPIC ANALYSIS (Title+Summary):\n")
    
    # Group videos by topic
    topic_videos = defaultdict(list)
    for i, topic in enumerate(topics_combined):
        topic_videos[topic].append(i)
    
    # Show each topic with examples
    for topic_id in sorted(topic_videos.keys())[:6]:  # Show first 6 topics
        if topic_id == -1:
            continue
            
        # Get topic keywords
        keywords = [word for word, _ in topic_model_combined.get_topic(topic_id)[:8]]
        
        # Get topic info
        topic_row = topic_info_combined[topic_info_combined['Topic'] == topic_id].iloc[0]
        count = topic_row['Count']
        
        print(f"\n{'='*60}")
        print(f"📌 TOPIC {topic_id} ({count} videos)")
        print(f"Keywords: {', '.join(keywords)}")
        
        # Analyze channel distribution
        channel_counts = defaultdict(int)
        for idx in topic_videos[topic_id]:
            channel_counts[videos[idx]['channel']] += 1
        
        print(f"Channels: ", end="")
        for ch, cnt in sorted(channel_counts.items(), key=lambda x: x[1], reverse=True):
            print(f"{ch} ({cnt}), ", end="")
        print()
        
        print(f"\nSample videos:")
        
        # Show up to 3 examples
        for idx in topic_videos[topic_id][:3]:
            video = videos[idx]
            print(f"\n  • {video['title'][:70]}...")
            print(f"    Summary: {video['summary'][:100]}...")
    
    # Comparison summary
    print("\n\n" + "="*80)
    print("📈 COMPARISON SUMMARY:\n")
    
    if num_topics_title > 0:
        topic_improvement = ((num_topics_combined - num_topics_title) / num_topics_title) * 100
    else:
        topic_improvement = 0
    
    if silhouette_title > 0:
        silhouette_improvement = ((silhouette_combined - silhouette_title) / silhouette_title) * 100
    else:
        silhouette_improvement = 0 if silhouette_combined == 0 else 100
    
    print(f"Topic Count:")
    print(f"  Title-only: {num_topics_title}")
    print(f"  Title+Summary: {num_topics_combined}")
    print(f"  Change: {topic_improvement:+.1f}%")
    
    print(f"\nClustering Quality (Silhouette Score):")
    print(f"  Title-only: {silhouette_title:.3f}")
    print(f"  Title+Summary: {silhouette_combined:.3f}")
    print(f"  Change: {silhouette_improvement:+.1f}%")
    
    print(f"\nOutlier Reduction:")
    print(f"  Title-only: {outliers_title} ({outliers_title/len(topics_title)*100:.1f}%)")
    print(f"  Title+Summary: {outliers_combined} ({outliers_combined/len(topics_combined)*100:.1f}%)")
    print(f"  Reduction: {outliers_title - outliers_combined} fewer outliers")
    
    # Show specific improvements
    print("\n🔍 Topic Quality Analysis:")
    
    # Find videos that moved from outlier to topic
    moved_from_outlier = []
    for i in range(len(topics_title)):
        if topics_title[i] == -1 and topics_combined[i] != -1:
            moved_from_outlier.append(i)
    
    if moved_from_outlier:
        print(f"\n{len(moved_from_outlier)} videos moved from outlier to proper topics:")
        for i in moved_from_outlier[:5]:
            print(f"  - \"{videos[i]['title'][:50]}...\"")
            print(f"    Summary: {videos[i]['summary'][:80]}...")
    
    # Final recommendation
    print("\n📋 RECOMMENDATION FOR YOUR CONTENT:")
    print(f"\nWith {len(videos)} videos tested from 3D Printing and Woodworking channels:")
    
    if topic_improvement > 20 or silhouette_improvement > 10 or (outliers_title - outliers_combined) > 10:
        print("✅ LLM summaries SIGNIFICANTLY improve clustering for your maker content!")
        print("   The $5-10 investment for 178K videos would provide:")
        print(f"   - {topic_improvement:.0f}% more specific topic clusters")
        print(f"   - {(outliers_title - outliers_combined)/outliers_title*100:.0f}% fewer uncategorized videos")
        print("   - Better separation between 3D printing, woodworking, and DIY subtopics")
    elif topic_improvement > 0 or silhouette_improvement > 0:
        print("⚡ LLM summaries provide moderate improvement.")
        print("   Consider implementing for high-value video subsets.")
    else:
        print("❌ LLM summaries don't significantly improve clustering.")
        print("   Your titles may already be descriptive enough.")

if __name__ == "__main__":
    analyze_real_videos_clustering()