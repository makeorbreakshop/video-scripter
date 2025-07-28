#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
import openai
import os
from dotenv import load_dotenv
import time

load_dotenv()
openai.api_key = os.getenv('OPENAI_API_KEY')

def get_embeddings_batch(texts, model="text-embedding-3-small"):
    """Get OpenAI embeddings for a batch of texts"""
    try:
        # OpenAI allows up to 2048 inputs per request
        response = openai.embeddings.create(
            input=texts,
            model=model
        )
        return [item.embedding for item in response.data]
    except Exception as e:
        print(f"Error getting embeddings: {e}")
        return []

def main():
    print("🎯 BERTopic Chapter Enhancement Test (Simple Version)\n")
    
    # Load the processed data
    print("Loading chapter data...")
    with open('chapter_enhanced_videos.json', 'r') as f:
        data = json.load(f)
    
    # Take first 300 videos for manageable testing
    data = data[:300]
    print(f"Using {len(data)} videos for comparison\n")
    
    # Prepare texts
    titles_only = [item['title'] for item in data]
    titles_with_chapters = [item['combined_text'] for item in data]
    
    # Show sample data
    print("Sample data:")
    for i in range(3):
        print(f"\nVideo {i+1}:")
        print(f"  Title: {data[i]['title'][:80]}...")
        print(f"  Chapters ({len(data[i]['chapters'])}): {', '.join(data[i]['chapters'][:5])}...")
    
    print("\n" + "="*60 + "\n")
    
    # Generate embeddings in batches
    print("📊 Generating embeddings for TITLE-ONLY...")
    title_embeddings = []
    batch_size = 100
    
    for i in range(0, len(titles_only), batch_size):
        batch = titles_only[i:i+batch_size]
        print(f"  Processing batch {i//batch_size + 1}...")
        embeddings = get_embeddings_batch(batch)
        title_embeddings.extend(embeddings)
        time.sleep(1)  # Rate limiting
    
    print(f"Generated {len(title_embeddings)} title embeddings")
    
    print("\n📊 Generating embeddings for TITLE+CHAPTERS...")
    combined_embeddings = []
    
    for i in range(0, len(titles_with_chapters), batch_size):
        batch = titles_with_chapters[i:i+batch_size]
        print(f"  Processing batch {i//batch_size + 1}...")
        embeddings = get_embeddings_batch(batch)
        combined_embeddings.extend(embeddings)
        time.sleep(1)  # Rate limiting
    
    print(f"Generated {len(combined_embeddings)} combined embeddings")
    
    # Convert to numpy arrays
    title_embeddings_np = np.array(title_embeddings)
    combined_embeddings_np = np.array(combined_embeddings)
    
    print("\n" + "="*60 + "\n")
    
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
        embeddings=title_embeddings_np
    )
    
    # Calculate metrics for title-only
    topic_info_title = topic_model_title.get_topic_info()
    num_topics_title = len([t for t in topic_info_title['Topic'] if t != -1])
    
    # Get non-outlier labels for silhouette score
    non_outlier_mask_title = np.array(topics_title) != -1
    if np.sum(non_outlier_mask_title) > 1:
        unique_topics = len(np.unique(np.array(topics_title)[non_outlier_mask_title]))
        if unique_topics > 1:
            silhouette_title = silhouette_score(
                title_embeddings_np[non_outlier_mask_title],
                np.array(topics_title)[non_outlier_mask_title]
            )
        else:
            silhouette_title = 0
    else:
        silhouette_title = 0
    
    print(f"\n✅ Title-only Results:")
    print(f"   Topics found: {num_topics_title}")
    print(f"   Silhouette score: {silhouette_title:.3f}")
    print(f"   Outliers: {np.sum(np.array(topics_title) == -1)}/{len(topics_title)} ({np.sum(np.array(topics_title) == -1)/len(topics_title)*100:.1f}%)")
    
    # Show top topics
    print("\n   Top 5 topics:")
    topic_count = 0
    for idx, row in topic_info_title.iterrows():
        if row['Topic'] != -1 and topic_count < 5:
            words = [word for word, _ in topic_model_title.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
            topic_count += 1
    
    print("\n" + "="*60 + "\n")
    
    # Run BERTopic on title+chapters
    print("🔬 Running BERTopic on TITLE+CHAPTERS embeddings...")
    topic_model_combined = BERTopic(
        min_topic_size=5,
        verbose=False,
        calculate_probabilities=True,
        nr_topics="auto"
    )
    
    topics_combined, probs_combined = topic_model_combined.fit_transform(
        titles_with_chapters,
        embeddings=combined_embeddings_np
    )
    
    # Calculate metrics for combined
    topic_info_combined = topic_model_combined.get_topic_info()
    num_topics_combined = len([t for t in topic_info_combined['Topic'] if t != -1])
    
    non_outlier_mask_combined = np.array(topics_combined) != -1
    if np.sum(non_outlier_mask_combined) > 1:
        unique_topics = len(np.unique(np.array(topics_combined)[non_outlier_mask_combined]))
        if unique_topics > 1:
            silhouette_combined = silhouette_score(
                combined_embeddings_np[non_outlier_mask_combined],
                np.array(topics_combined)[non_outlier_mask_combined]
            )
        else:
            silhouette_combined = 0
    else:
        silhouette_combined = 0
    
    print(f"\n✅ Title+Chapters Results:")
    print(f"   Topics found: {num_topics_combined}")
    print(f"   Silhouette score: {silhouette_combined:.3f}")
    print(f"   Outliers: {np.sum(np.array(topics_combined) == -1)}/{len(topics_combined)} ({np.sum(np.array(topics_combined) == -1)/len(topics_combined)*100:.1f}%)")
    
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
        silhouette_improvement = 0
    
    print(f"Topic Count:")
    print(f"  Title-only: {num_topics_title}")
    print(f"  Title+Chapters: {num_topics_combined}")
    print(f"  Change: {topic_improvement:+.1f}%")
    
    print(f"\nClustering Quality (Silhouette Score):")
    print(f"  Title-only: {silhouette_title:.3f}")
    print(f"  Title+Chapters: {silhouette_combined:.3f}")
    print(f"  Change: {silhouette_improvement:+.1f}%")
    
    print(f"\nOutlier Reduction:")
    outliers_title = np.sum(np.array(topics_title) == -1)
    outliers_combined = np.sum(np.array(topics_combined) == -1)
    print(f"  Title-only: {outliers_title} ({outliers_title/len(topics_title)*100:.1f}%)")
    print(f"  Title+Chapters: {outliers_combined} ({outliers_combined/len(topics_combined)*100:.1f}%)")
    print(f"  Reduction: {outliers_title - outliers_combined} fewer outliers")
    
    # Show example improvements
    print("\n🔍 Example Topic Improvements:")
    print("\nTitle-only topics (sample):")
    for i in range(min(3, len(topic_info_title))):
        if topic_info_title.iloc[i]['Topic'] != -1:
            topic_words = [w for w, _ in topic_model_title.get_topic(topic_info_title.iloc[i]['Topic'])[:8]]
            print(f"  - {', '.join(topic_words)}")
    
    print("\nTitle+Chapters topics (sample):")
    for i in range(min(3, len(topic_info_combined))):
        if topic_info_combined.iloc[i]['Topic'] != -1:
            topic_words = [w for w, _ in topic_model_combined.get_topic(topic_info_combined.iloc[i]['Topic'])[:8]]
            print(f"  - {', '.join(topic_words)}")
    
    # Save results
    results = {
        'sample_size': len(data),
        'title_only': {
            'num_topics': num_topics_title,
            'silhouette_score': float(silhouette_title),
            'outliers': int(outliers_title),
            'outlier_percentage': float(outliers_title/len(topics_title)*100),
            'total_videos': len(topics_title)
        },
        'title_plus_chapters': {
            'num_topics': num_topics_combined,
            'silhouette_score': float(silhouette_combined),
            'outliers': int(outliers_combined),
            'outlier_percentage': float(outliers_combined/len(topics_combined)*100),
            'total_videos': len(topics_combined)
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
    
    with open('bertopic_chapter_comparison_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("\n💾 Results saved to bertopic_chapter_comparison_results.json")
    
    # Final recommendation
    print("\n📋 RECOMMENDATION:")
    if topic_improvement > 20 or silhouette_improvement > 10:
        print("✅ Chapter titles significantly improve clustering!")
        print("   Consider extracting chapters for all videos with timestamps.")
    elif topic_improvement > 0 or silhouette_improvement > 0:
        print("⚡ Chapter titles provide moderate improvement.")
        print("   Worth implementing for videos with rich chapter data.")
    else:
        print("❌ Chapter titles don't improve clustering in this sample.")
        print("   May need larger sample or different approach.")

if __name__ == "__main__":
    main()