#!/usr/bin/env python3
"""
BERTopic optimized for ~2,000 topics
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

print("BERTopic Clustering - Targeting ~2,000 Topics")
print("=" * 60)
print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 60)

# Load all embeddings
print("\n📥 Loading all SBERT embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])
print(f"Found {len(part_files)} embedding files")

for part_file in tqdm(part_files, desc="Loading embeddings"):
    with open(os.path.join(embeddings_dir, part_file), 'r') as f:
        data = json.load(f)
        for item in data['embeddings']:
            all_embeddings.append(item['embedding'])
            all_documents.append(item['title'])
            all_ids.append(item['id'])

embeddings_array = np.array(all_embeddings)
print(f"\n✅ Loaded embeddings: {embeddings_array.shape}")
print(f"   Documents: {len(all_documents):,}")

# Configuration for ~2,000 topics
# Based on debug results: min_cluster_size=30 gave 644 topics estimate
# For 2,000 topics, we need min_cluster_size around 15-20
print("\n⚙️  Configuration for ~2,000 topics:")
print("   Min cluster size: 20 (for granular topics)")
print("   Min samples: 5")
print("   Algorithm: prims_kdtree (proven fast)")
print("   Target: ~2,000 topics")

# UMAP - keep same settings
umap_model = UMAP(
    n_neighbors=15,
    n_components=10,
    min_dist=0.0,
    metric='cosine',
    random_state=42,
    verbose=True
)

# HDBSCAN for ~2,000 topics
hdbscan_model = HDBSCAN(
    min_cluster_size=20,  # Smaller for more topics
    min_samples=5,
    metric='euclidean',
    algorithm='prims_kdtree',  # Proven fast in debug
    core_dist_n_jobs=-1,  # Use all cores
    prediction_data=True
)

# BERTopic
topic_model = BERTopic(
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    min_topic_size=20,  # Match HDBSCAN
    nr_topics="auto",
    calculate_probabilities=True,
    verbose=True
)

print("\n🚀 Running clustering for ~2,000 topics...")
print("Expected time: 5-10 minutes")
print("-" * 60)

start_time = time.time()

try:
    # Add progress tracking for HDBSCAN
    import threading
    stop_progress = False
    
    def show_progress():
        """Show progress dots during HDBSCAN"""
        dots = 0
        while not stop_progress:
            if dots % 40 == 0:
                print(f"\n   HDBSCAN processing", end="")
            print(".", end="", flush=True)
            dots += 1
            time.sleep(2)
    
    # Fit the model
    topics, probs = topic_model.fit_transform(all_documents, embeddings_array)
    stop_progress = True
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude -1 (outliers)
    
    print(f"\n\n✅ Clustering complete!")
    print(f"   Topics found: {n_topics}")
    print(f"   Outliers: {sum(1 for t in topics if t == -1):,} ({sum(1 for t in topics if t == -1)/len(topics)*100:.1f}%)")
    
    # Topic distribution
    print("\n📊 Topic Size Distribution:")
    topic_counts = topic_info[topic_info.Topic != -1]['Count'].values
    if len(topic_counts) > 0:
        print(f"   Smallest topic: {min(topic_counts)} videos")
        print(f"   Largest topic: {max(topic_counts)} videos")
        print(f"   Median topic size: {np.median(topic_counts):.0f} videos")
        print(f"   Average topic size: {np.mean(topic_counts):.0f} videos")
    
    # Save model
    print("\n💾 Saving BERTopic model...")
    model_path = 'bertopic_model_2000_topics'
    topic_model.save(model_path, serialization="pickle")
    print(f"   Model saved to: {model_path}")
    
    # Save assignments
    print("\n💾 Saving topic assignments...")
    assignments = []
    for i, (doc_id, topic) in enumerate(zip(all_ids, topics)):
        prob = probs[i][topic] if topic >= 0 and probs is not None else 0
        assignments.append({
            'video_id': doc_id,
            'topic': int(topic),
            'probability': float(prob),
            'title': all_documents[i]
        })
    
    with open('topic_assignments_2000.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_videos': len(assignments),
            'total_topics': n_topics,
            'outliers': sum(1 for a in assignments if a['topic'] == -1),
            'min_cluster_size': 20,
            'assignments': assignments
        }, f)
    
    print("   Assignments saved to: topic_assignments_2000.json")
    
    # Save topic keywords
    print("\n💾 Saving topic keywords...")
    topic_data = []
    for topic_id in range(n_topics):
        if topic_id >= 0:
            topic_words = topic_model.get_topic(topic_id)
            topic_data.append({
                'topic_id': topic_id,
                'size': len([t for t in topics if t == topic_id]),
                'words': [{'word': word, 'weight': float(weight)} for word, weight in topic_words[:20]]
            })
    
    with open('topic_keywords_2000.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_topics': n_topics,
            'topics': topic_data
        }, f)
    
    print("   Topic keywords saved")
    
except Exception as e:
    stop_progress = True
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()

# Summary
elapsed_time = time.time() - start_time
print("\n" + "=" * 60)
print("✅ CLUSTERING COMPLETE!")
print("=" * 60)
print(f"Total time: {elapsed_time/60:.1f} minutes")
print(f"Videos clustered: {len(all_documents):,}")
print(f"Topics discovered: {n_topics}")

if n_topics < 1500:
    print(f"\n⚠️  Found {n_topics} topics, less than target 2,000")
    print("   To get more topics, run again with min_cluster_size=15")
elif n_topics > 2500:
    print(f"\n⚠️  Found {n_topics} topics, more than target 2,000")
    print("   To get fewer topics, run again with min_cluster_size=25")