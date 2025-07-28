#!/usr/bin/env python3
import json
import numpy as np
import hdbscan
import time

# Load first file only
print("Loading embeddings...")
with open('embeddings-part-1.json', 'r') as f:
    data = json.load(f)

# Convert to numpy array
embeddings = np.array([e['values'] for e in data['embeddings']])
print(f"Loaded {len(embeddings)} embeddings")

# Simple test
print("\nRunning HDBSCAN...")
start = time.time()

clusterer = hdbscan.HDBSCAN(min_cluster_size=200)  # Very simple, one parameter
labels = clusterer.fit_predict(embeddings)

print(f"Done in {time.time() - start:.1f} seconds")
print(f"Clusters found: {len(set(labels)) - 1}")
print(f"Noise points: {list(labels).count(-1)}")

# Show a few examples
for i in range(5):
    if labels[i] != -1:
        title = data['embeddings'][i]['metadata']['title']
        print(f"\nCluster {labels[i]}: {title[:60]}...")