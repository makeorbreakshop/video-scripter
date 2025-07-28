#!/usr/bin/env python3
"""
Final BERTopic run - simplified without probabilities
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

print("BERTopic Final Run - Full Dataset")
print("=" * 60)
print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 60)

# Load embeddings
print("\n📥 Loading embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])

for part_file in tqdm(part_files, desc="Loading"):
    with open(os.path.join(embeddings_dir, part_file), 'r') as f:
        data = json.load(f)
        for item in data['embeddings']:
            all_embeddings.append(item['embedding'])
            all_documents.append(item['title'])
            all_ids.append(item['id'])

embeddings_array = np.array(all_embeddings)
print(f"✅ Loaded: {embeddings_array.shape}")

# Simple configuration
print("\n⚙️  Configuration:")
print("   UMAP: 10 dimensions")
print("   HDBSCAN: min_cluster_size=30")
print("   No probabilities (faster)")

# Models
umap_model = UMAP(
    n_neighbors=15,
    n_components=10,
    min_dist=0.0,
    metric='cosine',
    random_state=42,
    verbose=True
)

hdbscan_model = HDBSCAN(
    min_cluster_size=30,
    min_samples=5,
    metric='euclidean',
    algorithm='best',  # Let it choose
    core_dist_n_jobs=-1  # Use all cores
)

topic_model = BERTopic(
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    min_topic_size=30,
    calculate_probabilities=False,  # No probabilities
    verbose=True
)

print("\n🚀 Running BERTopic...")
start = time.time()

try:
    # Fit and transform
    topics, _ = topic_model.fit_transform(all_documents, embeddings_array)
    
    # Get info
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1
    n_outliers = sum(1 for t in topics if t == -1)
    
    print(f"\n✅ Complete in {(time.time()-start)/60:.1f} minutes!")
    print(f"Topics: {n_topics}")
    print(f"Outliers: {n_outliers:,} ({n_outliers/len(topics)*100:.1f}%)")
    
    # Topic sizes
    print("\n📊 Topic Distribution:")
    topic_counts = topic_info[topic_info.Topic != -1]['Count'].values
    print(f"Smallest: {min(topic_counts)} videos")
    print(f"Largest: {max(topic_counts)} videos")
    print(f"Median: {np.median(topic_counts):.0f} videos")
    
    # Save model
    print("\n💾 Saving...")
    topic_model.save("bertopic_model_final", serialization="pickle")
    
    # Save assignments
    assignments = []
    for i, (vid_id, topic) in enumerate(zip(all_ids, topics)):
        assignments.append({
            'video_id': vid_id,
            'topic': int(topic),
            'title': all_documents[i]
        })
    
    # Organize by tiers
    topic_sizes = []
    for t in range(n_topics):
        size = sum(1 for x in topics if x == t)
        if size > 0:
            topic_sizes.append({'id': t, 'size': size})
    
    topic_sizes.sort(key=lambda x: x['size'], reverse=True)
    
    # Simple tier assignment
    tier1 = topic_sizes[:30]
    tier2 = topic_sizes[30:250]
    tier3 = topic_sizes[250:]
    
    # Create output
    output = {
        'generated_at': datetime.now().isoformat(),
        'total_videos': len(assignments),
        'total_topics': n_topics,
        'outliers': n_outliers,
        'tiers': {
            'tier1_count': len(tier1),
            'tier2_count': len(tier2),
            'tier3_count': len(tier3)
        },
        'assignments': assignments
    }
    
    with open('bertopic_results_final.json', 'w') as f:
        json.dump(output, f)
    
    # Save topic keywords
    topic_keywords = []
    for t in range(n_topics):
        words = topic_model.get_topic(t)
        topic_keywords.append({
            'topic_id': t,
            'size': sum(1 for x in topics if x == t),
            'keywords': [w[0] for w in words[:10]]
        })
    
    with open('topic_keywords_final.json', 'w') as f:
        json.dump(topic_keywords, f, indent=2)
    
    print("✅ All files saved!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("Done! Check bertopic_results_final.json")