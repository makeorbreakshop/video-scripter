#!/usr/bin/env python3
"""
Test HDBSCAN with cosine distance (better for embeddings)
"""
import json
import numpy as np
import hdbscan
from sklearn.preprocessing import normalize
import time

print("Loading 10K embeddings for cosine test...")
with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

# Get embeddings and normalize for cosine distance
embeddings = np.array([e['values'] for e in data['embeddings']])
embeddings_normalized = normalize(embeddings, norm='l2', axis=1)
print(f"Loaded and normalized {len(embeddings)} embeddings")

# Test with cosine distance
print("\nTesting with COSINE distance (better for text embeddings)...")
start = time.time()

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=100,
    min_samples=50,
    metric='cosine',  # KEY CHANGE: cosine instead of euclidean
    cluster_selection_method='eom'
)

labels = clusterer.fit_predict(embeddings_normalized)
elapsed = time.time() - start

n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
n_noise = list(labels).count(-1)

print(f"\nCompleted in {elapsed:.1f} seconds")
print(f"Found {n_clusters} clusters")
print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")

# Show cluster distribution
if n_clusters > 0:
    unique, counts = np.unique(labels[labels != -1], return_counts=True)
    print(f"\nCluster sizes: {sorted(counts, reverse=True)[:10]}")
    
    # Show diverse samples
    print("\nSample videos from different clusters:")
    for cluster_id in range(min(5, n_clusters)):
        indices = np.where(labels == cluster_id)[0][:2]
        print(f"\nCluster {cluster_id}:")
        for idx in indices:
            title = data['embeddings'][idx].get('metadata', {}).get('title', 'Unknown')
            if title != 'Unknown':
                print(f"  - {title[:70]}")

print("\nRecommendation: If this finds more meaningful clusters, use cosine distance for the full run!")