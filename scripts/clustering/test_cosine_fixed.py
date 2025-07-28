#!/usr/bin/env python3
"""
Test HDBSCAN with precomputed cosine distance
"""
import json
import numpy as np
import hdbscan
from sklearn.metrics.pairwise import cosine_distances
import time

print("Loading 5K embeddings for faster cosine test...")
with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

# Use only 5K for faster testing
embeddings = np.array([e['values'] for e in data['embeddings'][:5000]])
titles = [e.get('metadata', {}).get('title', 'Unknown') for e in data['embeddings'][:5000]]
print(f"Loaded {len(embeddings)} embeddings")

# Compute cosine distance matrix
print("\nComputing cosine distances...")
start = time.time()
distance_matrix = cosine_distances(embeddings)
print(f"Distance matrix computed in {time.time() - start:.1f}s")

# Run HDBSCAN with precomputed distances
print("\nRunning HDBSCAN with cosine distances...")
start = time.time()

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=50,
    min_samples=25,
    metric='precomputed'
)

labels = clusterer.fit_predict(distance_matrix)
elapsed = time.time() - start

n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
n_noise = list(labels).count(-1)

print(f"\nCompleted in {elapsed:.1f} seconds")
print(f"Found {n_clusters} clusters")
print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")

# Show results
if n_clusters > 0:
    print("\nCluster summary:")
    for i in range(min(10, n_clusters)):
        cluster_mask = labels == i
        cluster_size = np.sum(cluster_mask)
        print(f"\nCluster {i} ({cluster_size} videos):")
        
        # Show first few non-Unknown titles
        shown = 0
        for idx in np.where(cluster_mask)[0]:
            if titles[idx] != 'Unknown' and shown < 3:
                print(f"  - {titles[idx][:70]}")
                shown += 1

# Compare with euclidean
print("\n" + "="*60)
print("For comparison, testing same data with Euclidean distance...")
clusterer_euc = hdbscan.HDBSCAN(min_cluster_size=50, min_samples=25, metric='euclidean')
labels_euc = clusterer_euc.fit_predict(embeddings)
n_clusters_euc = len(set(labels_euc)) - (1 if -1 in labels_euc else 0)
print(f"Euclidean found {n_clusters_euc} clusters with {list(labels_euc).count(-1)/len(labels_euc)*100:.1f}% noise")

print(f"\nCosine found {n_clusters} clusters, Euclidean found {n_clusters_euc} clusters")
print("Recommendation: Use whichever gives more meaningful clusters!")