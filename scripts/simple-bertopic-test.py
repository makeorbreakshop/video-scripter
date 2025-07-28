#!/usr/bin/env python3

import json
import numpy as np
from bertopic import BERTopic
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
import warnings
warnings.filterwarnings('ignore')

# Load data
print("Loading embeddings...")
with open('bertopic_comparison_data.json', 'r') as f:
    data = json.load(f)

print(f"Found {len(data)} approaches to compare\n")

for approach_name, items in data.items():
    print(f"\n{'='*50}")
    print(f"Testing: {approach_name}")
    print(f"{'='*50}")
    
    # Extract data
    embeddings = np.array([item['embedding'] for item in items])
    titles = [item['metadata']['title'] for item in items]
    
    print(f"Shape: {embeddings.shape}")
    print(f"Sample titles: {titles[:3]}")
    
    # Try simple KMeans first
    print("\n1. KMeans clustering (k=10):")
    kmeans = KMeans(n_clusters=10, random_state=42)
    clusters = kmeans.fit_predict(embeddings)
    silhouette = silhouette_score(embeddings, clusters)
    print(f"   Silhouette score: {silhouette:.3f}")
    
    # Try BERTopic
    print("\n2. BERTopic clustering:")
    try:
        topic_model = BERTopic(
            min_topic_size=5,
            verbose=False
        )
        topics, probs = topic_model.fit_transform(titles, embeddings=embeddings)
        
        num_topics = len(set(topics)) - (1 if -1 in topics else 0)
        outliers = sum(1 for t in topics if t == -1)
        
        print(f"   Topics found: {num_topics}")
        print(f"   Outliers: {outliers}")
        
        # Show top topics
        topic_info = topic_model.get_topic_info()
        print("\n   Top 3 topics:")
        for i, row in topic_info.head(4).iterrows():
            if row['Topic'] != -1:
                print(f"   - Topic {row['Topic']}: {row['Name'][:50]}... ({row['Count']} videos)")
                
    except Exception as e:
        print(f"   BERTopic failed: {e}")

print("\n\n✅ Analysis complete!")