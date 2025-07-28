#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
from sklearn.decomposition import PCA
import matplotlib.pyplot as plt

def analyze_bertopic_clustering():
    print("🔬 BERTopic Analysis: Title vs Title+Summary\n")
    
    # Load the data
    print("Loading embeddings data...")
    with open('llm_summary_embeddings.json', 'r') as f:
        data = json.load(f)
    
    videos = data['videos']
    title_embeddings = np.array(data['embeddings']['title_only'])
    combined_embeddings = np.array(data['embeddings']['title_plus_summary'])
    
    print(f"Loaded {len(videos)} videos with embeddings\n")
    
    # Show sample data
    print("Sample videos with summaries:")
    for i in range(min(3, len(videos))):
        print(f"\n{i+1}. {videos[i]['title'][:60]}...")
        print(f"   Summary: {videos[i]['summary']}")
    
    print("\n" + "="*60 + "\n")
    
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
    print("\n   Top 5 topics:")
    topic_count = 0
    for idx, row in topic_info_title.iterrows():
        if row['Topic'] != -1 and topic_count < 5:
            words = [word for word, _ in topic_model_title.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
            topic_count += 1
    
    print("\n" + "="*60 + "\n")
    
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
    print("\n   Top 5 topics:")
    topic_count = 0
    for idx, row in topic_info_combined.iterrows():
        if row['Topic'] != -1 and topic_count < 5:
            words = [word for word, _ in topic_model_combined.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
            topic_count += 1
    
    print("\n" + "="*60 + "\n")
    
    # Comparison summary
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
        for i in moved_from_outlier[:3]:
            print(f"  - \"{videos[i]['title'][:50]}...\"")
            print(f"    Summary: {videos[i]['summary'][:80]}...")
            topic_words = [w for w, _ in topic_model_combined.get_topic(topics_combined[i])[:3]]
            print(f"    New topic keywords: {', '.join(topic_words)}")
    
    # Save detailed results
    results = {
        'sample_size': len(videos),
        'title_only': {
            'num_topics': num_topics_title,
            'silhouette_score': float(silhouette_title),
            'outliers': int(outliers_title),
            'outlier_percentage': float(outliers_title/len(topics_title)*100)
        },
        'title_plus_summary': {
            'num_topics': num_topics_combined,
            'silhouette_score': float(silhouette_combined),
            'outliers': int(outliers_combined),
            'outlier_percentage': float(outliers_combined/len(topics_combined)*100)
        },
        'improvements': {
            'topic_count_change': int(num_topics_combined - num_topics_title),
            'topic_count_change_pct': float(topic_improvement),
            'silhouette_change': float(silhouette_combined - silhouette_title),
            'silhouette_change_pct': float(silhouette_improvement),
            'outlier_reduction': int(outliers_title - outliers_combined),
            'outlier_reduction_pct': float((outliers_title - outliers_combined)/outliers_title*100) if outliers_title > 0 else 0
        }
    }
    
    with open('bertopic_llm_summary_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("\n💾 Results saved to bertopic_llm_summary_results.json")
    
    # Recommendation
    print("\n📋 RECOMMENDATION:")
    if topic_improvement > 20 or silhouette_improvement > 10 or (outliers_title - outliers_combined) > 10:
        print("✅ LLM summaries SIGNIFICANTLY improve clustering!")
        print("   The investment of $17 for 170K videos would be well worth it.")
        print(f"   Expected benefits: {topic_improvement:.0f}% more topics, {(outliers_title - outliers_combined)/outliers_title*100:.0f}% fewer outliers")
    elif topic_improvement > 0 or silhouette_improvement > 0:
        print("⚡ LLM summaries provide moderate improvement.")
        print("   Consider implementing for high-value video subsets.")
    else:
        print("❌ LLM summaries don't improve clustering in this sample.")
        print("   May need different approach or larger sample.")

if __name__ == "__main__":
    analyze_bertopic_clustering()