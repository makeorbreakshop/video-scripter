#!/usr/bin/env python3
"""
Quick test with just 10K embeddings
"""
import json
import numpy as np
import hdbscan
import time

print("Quick HDBSCAN test with 10K embeddings...")

# Load just first file
with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

embeddings = [emb['values'] for emb in data['embeddings']]
embeddings_array = np.array(embeddings)
print(f"Loaded {len(embeddings)} embeddings")

# Test with moderate parameters
print("\nRunning HDBSCAN (min_cluster_size=50)...")
start = time.time()

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=50,
    min_samples=25,
    metric='euclidean',
    core_dist_n_jobs=-1
)

labels = clusterer.fit_predict(embeddings_array)
elapsed = time.time() - start

n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
n_noise = list(labels).count(-1)

print(f"\nCompleted in {elapsed:.1f} seconds!")
print(f"Found {n_clusters} clusters")
print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")

# Show distribution
unique, counts = np.unique(labels, return_counts=True)
print(f"\nCluster sizes: {sorted(counts[unique != -1])[:10]}...")