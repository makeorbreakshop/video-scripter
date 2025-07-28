#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
import openai
import os
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

load_dotenv()
openai.api_key = os.getenv('OPENAI_API_KEY')

def get_embedding(text, model="text-embedding-3-small"):
    """Get OpenAI embedding for text"""
    try:
        response = openai.embeddings.create(
            input=text,
            model=model
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error getting embedding: {e}")
        return None

def batch_get_embeddings(texts, batch_size=100):
    """Get embeddings in batches with progress tracking"""
    embeddings = []
    
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        print(f"Processing batch {i//batch_size + 1}/{(len(texts) + batch_size - 1)//batch_size}")
        
        # Use ThreadPoolExecutor for parallel processing
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {executor.submit(get_embedding, text): idx 
                      for idx, text in enumerate(batch)}
            
            batch_embeddings = [None] * len(batch)
            
            for future in as_completed(futures):
                idx = futures[future]
                try:
                    embedding = future.result()
                    if embedding:
                        batch_embeddings[idx] = embedding
                except Exception as e:
                    print(f"Error in batch: {e}")
            
        embeddings.extend([e for e in batch_embeddings if e is not None])
        
        # Rate limit handling
        if i + batch_size < len(texts):
            time.sleep(1)
    
    return embeddings

def main():
    print("🎯 BERTopic Chapter Enhancement Test\n")
    
    # Load the processed data
    print("Loading chapter data...")
    with open('chapter_enhanced_videos.json', 'r') as f:
        data = json.load(f)
    
    print(f"Loaded {len(data)} videos with chapters\n")
    
    # Prepare texts
    titles_only = [item['title'] for item in data]
    titles_with_chapters = [item['combined_text'] for item in data]
    
    # Sample info
    print("Sample data:")
    for i in range(3):
        print(f"\nVideo {i+1}:")
        print(f"  Title: {data[i]['title'][:80]}...")
        print(f"  Chapters: {', '.join(data[i]['chapters'][:5])}...")
        print(f"  Combined length: {len(data[i]['combined_text'])} chars")
    
    print("\n" + "="*60 + "\n")
    
    # Generate embeddings
    print("📊 Generating embeddings for TITLE-ONLY...")
    title_embeddings = batch_get_embeddings(titles_only)
    print(f"Generated {len(title_embeddings)} title embeddings")
    
    print("\n📊 Generating embeddings for TITLE+CHAPTERS...")
    combined_embeddings = batch_get_embeddings(titles_with_chapters)
    print(f"Generated {len(combined_embeddings)} combined embeddings")
    
    # Convert to numpy arrays
    title_embeddings_np = np.array(title_embeddings)
    combined_embeddings_np = np.array(combined_embeddings)
    
    print("\n" + "="*60 + "\n")
    
    # Run BERTopic on title-only
    print("🔬 Running BERTopic on TITLE-ONLY embeddings...")
    topic_model_title = BERTopic(
        min_topic_size=10,
        verbose=False,
        calculate_probabilities=True
    )
    
    topics_title, probs_title = topic_model_title.fit_transform(
        titles_only, 
        embeddings=title_embeddings_np
    )
    
    # Calculate metrics for title-only
    topic_info_title = topic_model_title.get_topic_info()
    num_topics_title = len(topic_info_title) - 1  # Exclude outlier topic
    
    # Get non-outlier labels for silhouette score
    non_outlier_mask_title = np.array(topics_title) != -1
    if np.sum(non_outlier_mask_title) > 1:
        silhouette_title = silhouette_score(
            title_embeddings_np[non_outlier_mask_title],
            np.array(topics_title)[non_outlier_mask_title]
        )
    else:
        silhouette_title = 0
    
    print(f"\n✅ Title-only Results:")
    print(f"   Topics found: {num_topics_title}")
    print(f"   Silhouette score: {silhouette_title:.3f}")
    print(f"   Outliers: {np.sum(np.array(topics_title) == -1)}/{len(topics_title)}")
    
    # Show top topics
    print("\n   Top 5 topics:")
    for idx, row in topic_info_title.head(6).iterrows():
        if row['Topic'] != -1:
            words = [word for word, _ in topic_model_title.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
    
    print("\n" + "="*60 + "\n")
    
    # Run BERTopic on title+chapters
    print("🔬 Running BERTopic on TITLE+CHAPTERS embeddings...")
    topic_model_combined = BERTopic(
        min_topic_size=10,
        verbose=False,
        calculate_probabilities=True
    )
    
    topics_combined, probs_combined = topic_model_combined.fit_transform(
        titles_with_chapters,
        embeddings=combined_embeddings_np
    )
    
    # Calculate metrics for combined
    topic_info_combined = topic_model_combined.get_topic_info()
    num_topics_combined = len(topic_info_combined) - 1
    
    non_outlier_mask_combined = np.array(topics_combined) != -1
    if np.sum(non_outlier_mask_combined) > 1:
        silhouette_combined = silhouette_score(
            combined_embeddings_np[non_outlier_mask_combined],
            np.array(topics_combined)[non_outlier_mask_combined]
        )
    else:
        silhouette_combined = 0
    
    print(f"\n✅ Title+Chapters Results:")
    print(f"   Topics found: {num_topics_combined}")
    print(f"   Silhouette score: {silhouette_combined:.3f}")
    print(f"   Outliers: {np.sum(np.array(topics_combined) == -1)}/{len(topics_combined)}")
    
    # Show top topics
    print("\n   Top 5 topics:")
    for idx, row in topic_info_combined.head(6).iterrows():
        if row['Topic'] != -1:
            words = [word for word, _ in topic_model_combined.get_topic(row['Topic'])[:5]]
            print(f"   Topic {row['Topic']}: {', '.join(words)} ({row['Count']} videos)")
    
    print("\n" + "="*60 + "\n")
    
    # Comparison summary
    print("📈 COMPARISON SUMMARY:\n")
    
    topic_improvement = ((num_topics_combined - num_topics_title) / num_topics_title) * 100
    silhouette_improvement = ((silhouette_combined - silhouette_title) / silhouette_title) * 100
    
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
    
    # Save results
    results = {
        'title_only': {
            'num_topics': num_topics_title,
            'silhouette_score': float(silhouette_title),
            'outliers': int(outliers_title),
            'total_videos': len(topics_title)
        },
        'title_plus_chapters': {
            'num_topics': num_topics_combined,
            'silhouette_score': float(silhouette_combined),
            'outliers': int(outliers_combined),
            'total_videos': len(topics_combined)
        },
        'improvements': {
            'topic_count_change_pct': float(topic_improvement),
            'silhouette_change_pct': float(silhouette_improvement),
            'outlier_reduction': int(outliers_title - outliers_combined)
        }
    }
    
    with open('bertopic_chapter_comparison_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print("\n💾 Results saved to bertopic_chapter_comparison_results.json")

if __name__ == "__main__":
    main()