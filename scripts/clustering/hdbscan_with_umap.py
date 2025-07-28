#!/usr/bin/env python3
"""
HDBSCAN with UMAP reduction - mimics what BERTopic does
"""
import json
import numpy as np
import hdbscan
from umap import UMAP
import time

print("Loading embeddings...")
embeddings_all = []
titles_all = []

# Load first 30K for testing
for i in range(1, 4):
    with open(f'embeddings-part-{i}.json', 'r') as f:
        data = json.load(f)
    
    for emb in data['embeddings']:
        embeddings_all.append(emb['values'])
        titles_all.append(emb.get('metadata', {}).get('title', 'Unknown'))

embeddings = np.array(embeddings_all[:30000])
titles = titles_all[:30000]
print(f"Loaded {len(embeddings)} embeddings")

# Step 1: UMAP reduction (THIS IS THE KEY!)
print("\nReducing dimensions with UMAP...")
start = time.time()

umap_model = UMAP(
    n_neighbors=15,
    n_components=10,  # Reduce to 10D
    min_dist=0.0,
    metric='cosine',
    random_state=42
)

embeddings_reduced = umap_model.fit_transform(embeddings)
print(f"Reduced from 512D to {embeddings_reduced.shape[1]}D in {time.time()-start:.1f}s")

# Step 2: HDBSCAN on reduced dimensions
print("\nClustering with HDBSCAN...")
start = time.time()

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=100,
    min_samples=50,
    metric='euclidean',
    cluster_selection_method='eom'
)

labels = clusterer.fit_predict(embeddings_reduced)

n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
n_noise = list(labels).count(-1)

print(f"Completed in {time.time()-start:.1f}s")
print(f"Found {n_clusters} clusters!")
print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")

# Show some clusters
if n_clusters > 0:
    print("\nSample clusters:")
    for i in range(min(5, n_clusters)):
        cluster_mask = labels == i
        cluster_size = np.sum(cluster_mask)
        print(f"\nCluster {i} ({cluster_size} videos):")
        
        # Show non-unknown titles
        shown = 0
        for idx in np.where(cluster_mask)[0]:
            if titles[idx] != 'Unknown' and shown < 3:
                print(f"  - {titles[idx][:70]}")
                shown += 1

print("\n✅ This is how BERTopic got 1,107 clusters from OpenAI embeddings!")