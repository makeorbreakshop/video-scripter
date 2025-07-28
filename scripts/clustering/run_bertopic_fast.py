#!/usr/bin/env python3
"""
Fast BERTopic with subsampling and optimizations
"""
import os
import json
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from hdbscan import HDBSCAN
from umap import UMAP
from tqdm import tqdm
import time

print("Fast BERTopic Clustering (Subsampling)")
print("=" * 60)

# Load embeddings
print("Loading embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])

for part_file in tqdm(part_files[:6], desc="Loading first 60K"):  # Only first 6 parts
    with open(os.path.join(embeddings_dir, part_file), 'r') as f:
        data = json.load(f)
        for item in data['embeddings']:
            all_embeddings.append(item['embedding'])
            all_documents.append(item['title'])
            all_ids.append(item['id'])

embeddings_array = np.array(all_embeddings)
print(f"Loaded: {embeddings_array.shape}")

# Faster UMAP
umap_model = UMAP(
    n_neighbors=15,
    n_components=10,
    min_dist=0.0,
    metric='cosine',
    random_state=42
)

# Faster HDBSCAN
hdbscan_model = HDBSCAN(
    min_cluster_size=50,  # Larger for speed
    min_samples=5,
    algorithm='best',
    core_dist_n_jobs=-1  # Use all cores
)

# BERTopic
topic_model = BERTopic(
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    min_topic_size=50,
    nr_topics="auto",
    calculate_probabilities=False,  # Skip for speed
    verbose=True
)

print("\n🚀 Running fast clustering...")
start = time.time()

topics, _ = topic_model.fit_transform(all_documents, embeddings_array)

elapsed = time.time() - start
print(f"\n✅ Complete in {elapsed/60:.1f} minutes!")
print(f"Topics found: {len(set(topics)) - 1}")
print(f"Documents: {len(topics):,}")

# Save results
with open('fast_clustering_results.json', 'w') as f:
    json.dump({
        'time': elapsed,
        'documents': len(topics),
        'topics': len(set(topics)) - 1,
        'topic_distribution': {str(t): topics.count(t) for t in set(topics)}
    }, f, indent=2)

print("\nResults saved to fast_clustering_results.json")