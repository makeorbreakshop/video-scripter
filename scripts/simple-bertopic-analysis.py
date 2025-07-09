#!/usr/bin/env python3
"""
Simple BERTopic Analysis using clean exported embeddings
Uses existing title embeddings exports for reliable clustering
"""

import json
import numpy as np
import pandas as pd
from bertopic import BERTopic
from sklearn.cluster import HDBSCAN
from umap import UMAP
import csv
import sys
csv.field_size_limit(sys.maxsize)
from datetime import datetime

def load_embeddings():
    """Load clean embeddings from exports"""
    print("📊 Loading clean embedding exports...")
    
    # Use the latest full embeddings export
    embedding_file = '/Users/brandoncullum/video-scripter/exports/title-embeddings-full-2025-07-08T18-18-10-540Z.json'
    
    with open(embedding_file, 'r') as f:
        data = json.load(f)
    
    vectors = data['vectors']
    print(f"   Loaded {len(vectors)} videos with embeddings")
    
    # Extract embeddings and metadata
    embeddings = []
    titles = []
    video_ids = []
    metadata = []
    
    for item in vectors:
        # Skip items without title
        if 'title' not in item['metadata'] or not item['metadata']['title']:
            continue
            
        embeddings.append(item['values'])
        titles.append(item['metadata']['title'])
        video_ids.append(item['id'])
        metadata.append({
            'video_id': item['id'],
            'title': item['metadata']['title'],
            'channel_name': item['metadata'].get('channel_name', ''),
            'view_count': item['metadata'].get('view_count', 0),
            'performance_ratio': item['metadata'].get('performance_ratio', 0)
        })
    
    return np.array(embeddings), titles, video_ids, metadata

def create_bertopic_model(min_topic_size=30):
    """Create BERTopic model with enhanced configuration for quality insights"""
    print(f"🧪 Creating BERTopic model (min_topic_size={min_topic_size})...")
    
    # Get number of CPU cores for parallel processing
    import multiprocessing
    n_cores = multiprocessing.cpu_count()
    print(f"   Using {n_cores} CPU cores for parallel processing")
    
    # UMAP for dimensionality reduction - optimized for quality
    umap_model = UMAP(
        n_neighbors=15,  # More neighbors for better local structure
        n_components=5,  # More dimensions for richer representation
        min_dist=0.0,
        metric='cosine',
        random_state=42,
        n_jobs=n_cores,  # Use all available cores
        low_memory=False,  # Use more memory for speed
        verbose=True
    )
    
    # HDBSCAN for clustering - optimized for quality
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_topic_size,
        metric='euclidean',
        cluster_selection_method='eom'
    )
    
    # Create BERTopic model with enhanced features
    topic_model = BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        verbose=True,
        calculate_probabilities=True,  # Enable for better topic assignment
        nr_topics='auto'  # Let BERTopic optimize number of topics
    )
    
    return topic_model

def run_bertopic_analysis():
    """Run complete BERTopic analysis"""
    print("🚀 Starting Simple BERTopic Analysis")
    print("=" * 60)
    
    # Load data
    embeddings, titles, video_ids, metadata = load_embeddings()
    
    # Create model with smaller min_topic_size for more granular topics
    topic_model = create_bertopic_model(min_topic_size=25)
    
    # Fit model
    print("\n🔍 Fitting BERTopic model...")
    topics, probabilities = topic_model.fit_transform(titles, embeddings)
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    
    print(f"\n✅ Analysis Complete!")
    print(f"   Topics discovered: {len(topic_info)}")
    print(f"   Videos categorized: {sum(np.array(topics) != -1)}")
    print(f"   Outliers: {sum(np.array(topics) == -1)}")
    
    # Create results CSV
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Save topic assignments
    print(f"\n💾 Saving results...")
    
    results = []
    for i, (video_id, title, topic_id) in enumerate(zip(video_ids, titles, topics)):
        # Ensure topic_id is an integer
        if not isinstance(topic_id, (int, np.integer)):
            print(f"WARNING: Non-integer topic ID at index {i}: {topic_id} (type: {type(topic_id)})")
            topic_id = int(topic_id) if str(topic_id).lstrip('-').isdigit() else -1
            
        results.append({
            'video_id': video_id,
            'title': title,
            'cluster': int(topic_id),  # Explicitly convert to int
            'channel_name': metadata[i]['channel_name'],
            'view_count': metadata[i]['view_count'],
            'performance_ratio': metadata[i]['performance_ratio']
        })
    
    # Save to CSV with proper quoting
    csv_file = f'bertopic_results_{timestamp}.csv'
    with open(csv_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, 
                                fieldnames=['video_id', 'title', 'cluster', 'channel_name', 'view_count', 'performance_ratio'],
                                quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()
        writer.writerows(results)
    
    print(f"   Results saved to: {csv_file}")
    
    # Display top topics with more detail
    print(f"\n🎯 Top 20 Topics (excluding outliers):")
    topic_count = 0
    for i, row in topic_info.iterrows():
        topic_id = row['Topic']
        if topic_id != -1 and topic_count < 20:  # Skip outliers, show top 20
            count = row['Count']
            top_words = topic_model.get_topic(topic_id)[:8]  # More keywords
            keywords = [word for word, score in top_words]
            print(f"   Topic {topic_id}: {count} videos")
            print(f"      Keywords: {', '.join(keywords)}")
            topic_count += 1
    
    # Show topic distribution statistics
    print(f"\n📊 Topic Statistics:")
    print(f"   Total topics discovered: {len(topic_info) - 1}")  # Exclude -1
    print(f"   Videos in topics: {sum(np.array(topics) != -1)}")
    print(f"   Outliers: {sum(np.array(topics) == -1)}")
    print(f"   Average videos per topic: {sum(np.array(topics) != -1) / (len(topic_info) - 1):.1f}")
    
    return csv_file, topic_model

if __name__ == "__main__":
    csv_file, model = run_bertopic_analysis()
    print(f"\n🎉 BERTopic analysis complete!")
    print(f"Use this CSV file for cluster assignment: {csv_file}")