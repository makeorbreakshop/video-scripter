#!/usr/bin/env python3
"""
Optimized BERTopic for full 173K dataset
Based on successful fast run parameters
"""
import os
import sys
import json
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from hdbscan import HDBSCAN
from umap import UMAP
from tqdm import tqdm
import time

print("Optimized BERTopic Clustering for 173K Videos")
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

# Optimized parameters for ~2000 topics
print("\n⚙️  Configuration for ~2,000 topics:")
print("   Min cluster size: 30 (for more granular topics)")
print("   UMAP n_neighbors: 15")
print("   UMAP n_components: 10")
print("   Using all CPU cores")
print("   Target: ~2,000 topics (170K videos / 85 avg per topic)")

# UMAP with proven settings
umap_model = UMAP(
    n_neighbors=15,
    n_components=10,
    min_dist=0.0,
    metric='cosine',
    random_state=42,
    verbose=True
)

# HDBSCAN for more granular topics
hdbscan_model = HDBSCAN(
    min_cluster_size=30,  # Smaller for ~2000 topics
    min_samples=5,
    metric='euclidean',
    algorithm='best',
    core_dist_n_jobs=-1,  # Use all cores
    prediction_data=True
)

# BERTopic with granular settings
topic_model = BERTopic(
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    min_topic_size=30,  # Match HDBSCAN
    nr_topics="auto",
    calculate_probabilities=True,
    verbose=True
)

print("\n🚀 Running optimized clustering...")
print("Expected time: 5-10 minutes based on test run")
print("-" * 60)

start_time = time.time()

try:
    # Fit the model
    topics, probs = topic_model.fit_transform(all_documents, embeddings_array)
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude -1 (outliers)
    
    print(f"\n✅ Clustering complete!")
    print(f"   Topics found: {n_topics}")
    print(f"   Outliers: {sum(1 for t in topics if t == -1):,} ({sum(1 for t in topics if t == -1)/len(topics)*100:.1f}%)")
    
    # Show topic distribution
    print("\n📊 Topic Size Distribution:")
    topic_counts = topic_info[topic_info.Topic != -1]['Count'].values
    if len(topic_counts) > 0:
        print(f"   Smallest topic: {min(topic_counts)} videos")
        print(f"   Largest topic: {max(topic_counts)} videos")
        print(f"   Median topic size: {np.median(topic_counts):.0f} videos")
        print(f"   Average topic size: {np.mean(topic_counts):.0f} videos")
    
    # Save the model
    print("\n💾 Saving BERTopic model...")
    model_path = 'bertopic_model_optimized'
    topic_model.save(model_path, serialization="pickle")
    print(f"   Model saved to: {model_path}")
    
    # Save topic assignments
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
    
    output_file = 'topic_assignments_optimized.json'
    with open(output_file, 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_videos': len(assignments),
            'total_topics': n_topics,
            'outliers': sum(1 for a in assignments if a['topic'] == -1),
            'min_cluster_size': 50,
            'assignments': assignments
        }, f)
    
    print(f"   Assignments saved to: {output_file}")
    
    # Save topic information
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
    
    with open('topic_keywords_optimized.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_topics': n_topics,
            'topics': topic_data
        }, f)
    
    print("   Topic keywords saved")
    
except Exception as e:
    print(f"\n❌ Error during clustering: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Summary
elapsed_time = time.time() - start_time
print("\n" + "=" * 60)
print("✅ OPTIMIZED CLUSTERING COMPLETE!")
print("=" * 60)
print(f"Total time: {elapsed_time/60:.1f} minutes")
print(f"Videos clustered: {len(all_documents):,}")
print(f"Topics discovered: {n_topics}")
print(f"Processing speed: {len(all_documents)/elapsed_time:.0f} videos/second")

print(f"\nFiles created:")
print(f"  - {model_path}/ (model)")
print(f"  - topic_assignments_optimized.json")
print(f"  - topic_keywords_optimized.json")

print(f"\nNext steps:")
print(f"1. Review topics in topic_keywords_optimized.json")
print(f"2. Generate semantic names")
print(f"3. Save to database")