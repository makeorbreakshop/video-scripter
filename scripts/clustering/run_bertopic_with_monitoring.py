#!/usr/bin/env python3
"""
BERTopic with real-time progress monitoring
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
import threading
import psutil

print("BERTopic with Progress Monitoring")
print("=" * 60)

# Load embeddings (just first 50K for testing)
print("\n📥 Loading embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

# Load only 50K for reasonable test
target_size = 50000
loaded = 0

part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])

for part_file in tqdm(part_files[:5], desc="Loading 50K videos"):
    with open(os.path.join(embeddings_dir, part_file), 'r') as f:
        data = json.load(f)
        for item in data['embeddings']:
            if loaded >= target_size:
                break
            all_embeddings.append(item['embedding'])
            all_documents.append(item['title'])
            all_ids.append(item['id'])
            loaded += 1

embeddings_array = np.array(all_embeddings[:target_size])
documents = all_documents[:target_size]

print(f"✅ Loaded: {embeddings_array.shape}")

# Progress monitoring thread
stop_monitoring = False
phase = "Starting"
start_time = time.time()

def monitor_progress():
    """Monitor CPU and memory during processing"""
    process = psutil.Process()
    
    while not stop_monitoring:
        cpu = process.cpu_percent(interval=0.5)
        mem = process.memory_info().rss / 1024 / 1024 / 1024  # GB
        elapsed = int(time.time() - start_time)
        
        # Status indicator
        if cpu > 80:
            status = "🟢 Working hard"
        elif cpu > 30:
            status = "🟡 Processing"
        else:
            status = "🔴 Low activity"
        
        print(f"\r[{elapsed:3d}s] Phase: {phase:<20} | CPU: {cpu:5.1f}% | RAM: {mem:4.1f}GB | {status}    ", 
              end="", flush=True)
        time.sleep(1)

# Start monitoring
monitor_thread = threading.Thread(target=monitor_progress, daemon=True)
monitor_thread.start()

try:
    # UMAP Phase
    phase = "UMAP reduction"
    print("\n\n1️⃣ UMAP Dimensionality Reduction...")
    
    umap_model = UMAP(
        n_neighbors=15,
        n_components=10,
        min_dist=0.0,
        metric='cosine',
        random_state=42,
        verbose=False  # Quiet to see our monitoring
    )
    
    umap_start = time.time()
    reduced_embeddings = umap_model.fit_transform(embeddings_array)
    umap_time = time.time() - umap_start
    
    print(f"\n✅ UMAP complete in {umap_time:.1f}s")
    print(f"   Reduced to: {reduced_embeddings.shape}")
    
    # HDBSCAN Phase
    phase = "HDBSCAN clustering"
    print("\n2️⃣ HDBSCAN Clustering...")
    print("   This is where it usually hangs - watch the monitor!")
    
    # Try with explicit parameters
    clusterer = HDBSCAN(
        min_cluster_size=30,
        min_samples=5,
        metric='euclidean',
        algorithm='prims_kdtree',  # Explicit algorithm
        core_dist_n_jobs=4,  # Limit cores to prevent deadlock
        prediction_data=False,  # Faster
        approx_min_span_tree=True,  # Faster approximation
        gen_min_span_tree=False  # Don't generate tree
        # Removed memory=None which was causing the error
    )
    
    hdbscan_start = time.time()
    
    # Fit with timeout check
    import signal
    
    def timeout_handler(signum, frame):
        raise TimeoutError("HDBSCAN took too long!")
    
    # Set 5 minute timeout
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(300)  # 5 minutes
    
    try:
        cluster_labels = clusterer.fit_predict(reduced_embeddings)
        signal.alarm(0)  # Cancel timeout
        hdbscan_time = time.time() - hdbscan_start
        
        n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
        n_noise = list(cluster_labels).count(-1)
        
        print(f"\n✅ HDBSCAN complete in {hdbscan_time:.1f}s")
        print(f"   Clusters found: {n_clusters}")
        print(f"   Noise points: {n_noise} ({n_noise/len(cluster_labels)*100:.1f}%)")
        
    except TimeoutError:
        print("\n❌ HDBSCAN timeout after 5 minutes!")
        print("   This configuration is too slow")
        raise
    
    # BERTopic Phase
    phase = "BERTopic processing"
    print("\n3️⃣ Running full BERTopic...")
    
    topic_model = BERTopic(
        umap_model=None,  # Already reduced
        hdbscan_model=clusterer,  # Reuse fitted model
        min_topic_size=30,
        nr_topics="auto",
        calculate_probabilities=False,  # Faster
        verbose=False
    )
    
    bertopic_start = time.time()
    topics, _ = topic_model.fit_transform(documents, reduced_embeddings)
    bertopic_time = time.time() - bertopic_start
    
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1
    
    print(f"\n✅ BERTopic complete in {bertopic_time:.1f}s")
    print(f"   Final topics: {n_topics}")
    
    # Save results
    phase = "Saving results"
    with open('monitoring_test_results.json', 'w') as f:
        json.dump({
            'videos': len(documents),
            'umap_time': umap_time,
            'hdbscan_time': hdbscan_time,
            'bertopic_time': bertopic_time,
            'total_time': time.time() - start_time,
            'topics_found': n_topics,
            'clusters_found': n_clusters,
            'noise_ratio': n_noise/len(cluster_labels)
        }, f, indent=2)
    
except Exception as e:
    print(f"\n\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
finally:
    stop_monitoring = True
    time.sleep(1)

print("\n\n" + "="*60)
print("Test complete! Check monitoring_test_results.json")
print("="*60)

# Recommendations based on results
if os.path.exists('monitoring_test_results.json'):
    with open('monitoring_test_results.json', 'r') as f:
        results = json.load(f)
    
    if results['hdbscan_time'] > 60:
        print("\n⚠️  HDBSCAN is too slow!")
        print("Recommendations:")
        print("1. Use min_cluster_size=50 or higher")
        print("2. Try algorithm='boruvka_kdtree'")
        print("3. Set leaf_size=40 for kdtree")
        print("4. Consider subsampling to 100K videos")
    else:
        print("\n✅ Performance looks good!")
        print(f"Full 173K dataset should take ~{results['total_time'] * 3.5:.0f} seconds")