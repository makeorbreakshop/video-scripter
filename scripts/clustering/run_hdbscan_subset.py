#!/usr/bin/env python3
"""
Run HDBSCAN on a subset of embeddings for faster testing
"""
import json
import numpy as np
import hdbscan
from datetime import datetime
import time

print("Running HDBSCAN on 10K subset for quick results...")

# Load just the first file (10K embeddings)
with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

embeddings = []
ids = []
titles = []

for emb in data['embeddings']:
    embeddings.append(emb['values'])
    ids.append(emb['id'])
    titles.append(emb.get('metadata', {}).get('title', 'Unknown'))

embeddings_array = np.array(embeddings)
print(f"Testing with {len(embeddings)} embeddings")

# Test with reasonable parameters
params = {'min_cluster_size': 30, 'min_samples': 15}

print(f"\nRunning HDBSCAN with {params}")
start_time = time.time()

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=params['min_cluster_size'],
    min_samples=params['min_samples'],
    metric='euclidean',
    cluster_selection_method='eom',
    core_dist_n_jobs=-1
)

labels = clusterer.fit_predict(embeddings_array)
elapsed = time.time() - start_time

# Results
n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
n_noise = list(labels).count(-1)

print(f"\nCompleted in {elapsed:.1f} seconds")
print(f"Found {n_clusters} clusters")
print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")

# Show sample clusters
print("\nSample clusters:")
for cluster_id in range(min(5, n_clusters)):
    cluster_indices = [i for i, l in enumerate(labels) if l == cluster_id]
    if cluster_indices:
        print(f"\nCluster {cluster_id} ({len(cluster_indices)} videos):")
        for i in cluster_indices[:3]:  # Show first 3
            print(f"  - {titles[i][:80]}")

# Save results
results = {
    'subset_size': len(embeddings),
    'n_clusters': n_clusters,
    'n_noise': n_noise,
    'params': params,
    'elapsed_seconds': elapsed
}

with open('hdbscan_subset_results.json', 'w') as f:
    json.dump(results, f, indent=2)

print(f"\nResults saved to hdbscan_subset_results.json")
print("\nThe full 170K clustering is still running in the background...")