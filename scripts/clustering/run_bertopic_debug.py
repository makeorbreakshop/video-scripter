#!/usr/bin/env python3
"""
BERTopic with detailed debugging and progress monitoring
"""
import os
import json
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from hdbscan import HDBSCAN
from umap import UMAP
from sklearn.feature_extraction.text import CountVectorizer
from tqdm import tqdm
import time
import warnings
warnings.filterwarnings('ignore')

print("BERTopic Debug Mode - Detailed Progress Tracking")
print("=" * 60)

# Test on smaller sample first
SAMPLE_SIZE = 20000  # Start small
print(f"Testing with {SAMPLE_SIZE:,} videos first")

# Load limited embeddings
print("\n📥 Loading embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])

# Load only enough for sample
loaded = 0
for part_file in part_files:
    if loaded >= SAMPLE_SIZE:
        break
    with open(os.path.join(embeddings_dir, part_file), 'r') as f:
        data = json.load(f)
        for item in data['embeddings']:
            if loaded >= SAMPLE_SIZE:
                break
            all_embeddings.append(item['embedding'])
            all_documents.append(item['title'])
            all_ids.append(item['id'])
            loaded += 1

embeddings_array = np.array(all_embeddings[:SAMPLE_SIZE])
documents = all_documents[:SAMPLE_SIZE]
print(f"✅ Loaded: {embeddings_array.shape}")

# Test different configurations
configs = [
    {"min_cluster_size": 100, "algorithm": "best", "name": "Large clusters (fast)"},
    {"min_cluster_size": 50, "algorithm": "prims_kdtree", "name": "Medium clusters (kdtree)"},
    {"min_cluster_size": 30, "algorithm": "prims_balltree", "name": "Small clusters (balltree)"},
]

for config in configs:
    print(f"\n{'='*60}")
    print(f"Testing: {config['name']}")
    print(f"Config: min_cluster_size={config['min_cluster_size']}, algorithm={config['algorithm']}")
    print("="*60)
    
    # UMAP
    print("\n1️⃣ UMAP Phase...")
    umap_start = time.time()
    umap_model = UMAP(
        n_neighbors=15,
        n_components=10,
        min_dist=0.0,
        metric='cosine',
        random_state=42,
        verbose=False  # Quiet for timing
    )
    reduced_embeddings = umap_model.fit_transform(embeddings_array)
    umap_time = time.time() - umap_start
    print(f"   ✅ UMAP done in {umap_time:.1f}s")
    print(f"   Reduced to: {reduced_embeddings.shape}")
    
    # HDBSCAN
    print("\n2️⃣ HDBSCAN Phase...")
    hdbscan_start = time.time()
    
    # Create HDBSCAN with specific config
    clusterer = HDBSCAN(
        min_cluster_size=config['min_cluster_size'],
        min_samples=5,
        metric='euclidean',
        algorithm=config['algorithm'],
        core_dist_n_jobs=4,  # Limit cores for testing
        prediction_data=False  # Faster without
    )
    
    # Fit with progress monitoring
    print("   Fitting HDBSCAN...")
    try:
        cluster_labels = clusterer.fit_predict(reduced_embeddings)
        hdbscan_time = time.time() - hdbscan_start
        
        # Results
        n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
        n_noise = list(cluster_labels).count(-1)
        
        print(f"   ✅ HDBSCAN done in {hdbscan_time:.1f}s")
        print(f"   Clusters found: {n_clusters}")
        print(f"   Noise points: {n_noise} ({n_noise/len(cluster_labels)*100:.1f}%)")
        
        # Estimate for full dataset
        scale_factor = (173138 / SAMPLE_SIZE) ** 1.5
        est_time = (umap_time + hdbscan_time) * scale_factor / 60
        est_clusters = n_clusters * (173138 / SAMPLE_SIZE) ** 0.5
        
        print(f"\n   📊 Estimates for 173K videos:")
        print(f"   Time: ~{est_time:.0f} minutes")
        print(f"   Clusters: ~{est_clusters:.0f}")
        
    except Exception as e:
        print(f"   ❌ HDBSCAN failed: {e}")
        continue
    
    # Quick BERTopic test
    print("\n3️⃣ Full BERTopic test...")
    bertopic_start = time.time()
    
    try:
        # Minimal BERTopic
        topic_model = BERTopic(
            umap_model=umap_model,
            hdbscan_model=clusterer,
            min_topic_size=config['min_cluster_size'],
            nr_topics="auto",
            calculate_probabilities=False,
            vectorizer_model=CountVectorizer(max_features=100),  # Faster
            verbose=False
        )
        
        topics, _ = topic_model.fit_transform(documents, embeddings_array)
        bertopic_time = time.time() - bertopic_start
        
        topic_info = topic_model.get_topic_info()
        n_topics = len(topic_info) - 1
        
        print(f"   ✅ BERTopic done in {bertopic_time:.1f}s")
        print(f"   Final topics: {n_topics}")
        
    except Exception as e:
        print(f"   ❌ BERTopic failed: {e}")

print("\n" + "="*60)
print("RECOMMENDATIONS:")
print("="*60)
print("\n1. If HDBSCAN takes >30s on 20K samples, it will be too slow for 173K")
print("2. Best algorithm is usually 'best' (auto-selects)")
print("3. For ~2,000 topics on 173K videos, use min_cluster_size=50-80")
print("\nChoose the config with best time/cluster balance above!")