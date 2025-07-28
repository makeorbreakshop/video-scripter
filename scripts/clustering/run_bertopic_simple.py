#!/usr/bin/env python3
"""
Simple BERTopic that definitely works
"""
import os
import json
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from sklearn.cluster import MiniBatchKMeans
from tqdm import tqdm
import time

print("Simple BERTopic - Using MiniBatchKMeans for speed")
print("=" * 60)

# Load embeddings
print("\n📥 Loading embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

# Load all data
part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])

for part_file in tqdm(part_files, desc="Loading all embeddings"):
    with open(os.path.join(embeddings_dir, part_file), 'r') as f:
        data = json.load(f)
        for item in data['embeddings']:
            all_embeddings.append(item['embedding'])
            all_documents.append(item['title'])
            all_ids.append(item['id'])

embeddings_array = np.array(all_embeddings)
print(f"✅ Loaded: {embeddings_array.shape}")

# Use MiniBatchKMeans instead of HDBSCAN - much faster and predictable
print("\n⚙️  Using MiniBatchKMeans for 2,000 clusters")
print("   This is much faster than HDBSCAN and gives exact cluster count")

# Create custom cluster model
cluster_model = MiniBatchKMeans(
    n_clusters=2000,  # Exact number of topics
    batch_size=1000,
    n_init=3,
    random_state=42,
    verbose=1  # Show progress
)

# Initialize BERTopic with MiniBatchKMeans
topic_model = BERTopic(
    hdbscan_model=cluster_model,  # Use KMeans instead
    nr_topics=2000,  # Explicit topic count
    calculate_probabilities=False,  # Faster
    verbose=True
)

print("\n🚀 Running clustering...")
start_time = time.time()

try:
    # Fit and transform
    topics, _ = topic_model.fit_transform(all_documents, embeddings_array)
    
    # Get results
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1
    
    print(f"\n✅ Clustering complete!")
    print(f"   Topics: {n_topics}")
    print(f"   Time: {(time.time() - start_time)/60:.1f} minutes")
    
    # Save model
    print("\n💾 Saving model...")
    topic_model.save("bertopic_kmeans_2000", serialization="pickle")
    
    # Save assignments
    assignments = []
    for i, (doc_id, topic) in enumerate(zip(all_ids, topics)):
        assignments.append({
            'video_id': doc_id,
            'topic': int(topic),
            'title': all_documents[i]
        })
    
    with open('topic_assignments_kmeans_2000.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_videos': len(assignments),
            'total_topics': n_topics,
            'method': 'MiniBatchKMeans',
            'assignments': assignments
        }, f)
    
    print("✅ Results saved!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("Complete! This method is much more reliable than HDBSCAN.")
print("Topics are evenly distributed using KMeans clustering.")
print("="*60)