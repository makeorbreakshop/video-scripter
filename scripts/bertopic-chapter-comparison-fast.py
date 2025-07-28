#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
import openai
import os
from dotenv import load_dotenv
from pinecone import Pinecone
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

load_dotenv()
openai.api_key = os.getenv('OPENAI_API_KEY')

# Initialize Pinecone
pc = Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
index = pc.Index(os.getenv('PINECONE_INDEX_NAME'))

def get_title_embedding_from_pinecone(video_id):
    """Fetch existing title embedding from Pinecone"""
    try:
        result = index.fetch(ids=[f"video-{video_id}"])
        if result['vectors'] and f"video-{video_id}" in result['vectors']:
            return result['vectors'][f"video-{video_id}"]['values']
    except:
        pass
    return None

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

def main():
    print("🎯 BERTopic Chapter Enhancement Test (Fast Version)\n")
    
    # Load the processed data
    print("Loading chapter data...")
    with open('chapter_enhanced_videos.json', 'r') as f:
        data = json.load(f)
    
    # Take first 500 videos for faster testing
    data = data[:500]
    print(f"Using {len(data)} videos for comparison\n")
    
    # Fetch existing title embeddings from Pinecone
    print("📊 Fetching existing title embeddings from Pinecone...")
    title_embeddings = []
    combined_texts = []
    valid_indices = []
    
    for i, item in enumerate(data):
        embedding = get_title_embedding_from_pinecone(item['id'])
        if embedding:
            title_embeddings.append(embedding)
            combined_texts.append(item['combined_text'])
            valid_indices.append(i)
        
        if (i + 1) % 100 == 0:
            print(f"  Fetched {i + 1}/{len(data)} embeddings...")
    
    print(f"\nSuccessfully fetched {len(title_embeddings)} title embeddings")
    
    # Generate embeddings only for combined text
    print("\n📊 Generating embeddings for TITLE+CHAPTERS...")
    combined_embeddings = []
    
    # Process in smaller batches
    batch_size = 50
    for i in range(0, len(combined_texts), batch_size):
        batch = combined_texts[i:i+batch_size]
        print(f"  Processing batch {i//batch_size + 1}/{(len(combined_texts) + batch_size - 1)//batch_size}")
        
        for text in batch:
            embedding = get_embedding(text)
            if embedding:
                combined_embeddings.append(embedding)
            time.sleep(0.1)  # Rate limiting
    
    print(f"Generated {len(combined_embeddings)} combined embeddings")
    
    # Ensure we have same number of embeddings
    min_length = min(len(title_embeddings), len(combined_embeddings))
    title_embeddings = title_embeddings[:min_length]
    combined_embeddings = combined_embeddings[:min_length]
    titles_only = [data[i]['title'] for i in valid_indices[:min_length]]
    titles_with_chapters = [data[i]['combined_text'] for i in valid_indices[:min_length]]
    
    # Convert to numpy arrays
    title_embeddings_np = np.array(title_embeddings)
    combined_embeddings_np = np.array(combined_embeddings)
    
    print("\n" + "="*60 + "\n")
    
    # Run BERTopic on title-only
    print("🔬 Running BERTopic on TITLE-ONLY embeddings...")
    topic_model_title = BERTopic(
        min_topic_size=5,  # Smaller for faster testing
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
        min_topic_size=5,
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