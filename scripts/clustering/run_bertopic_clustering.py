#!/usr/bin/env python3
"""
Run BERTopic clustering on SBERT embeddings
"""
import os
import sys
import json
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from sklearn.cluster import MiniBatchKMeans
from hdbscan import HDBSCAN
from umap import UMAP
from tqdm import tqdm
import time
import pickle

print("BERTopic Clustering on 173K Videos")
print("=" * 60)
print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 60)

# Load all embeddings
print("\n📥 Loading SBERT embeddings...")
embeddings_dir = 'sbert_embeddings'
all_embeddings = []
all_documents = []
all_ids = []

# Get all part files
part_files = sorted([f for f in os.listdir(embeddings_dir) if f.startswith('sbert_embeddings_part_')])
print(f"Found {len(part_files)} embedding files")

# Load each part
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

# Configure BERTopic
print("\n⚙️  Configuring BERTopic...")
print("   Min cluster size: 10 (for granular topics)")
print("   UMAP dimensions: 10 (for density)")
print("   HDBSCAN min_samples: 5")

# Custom UMAP for better control
umap_model = UMAP(
    n_neighbors=15,
    n_components=10,
    min_dist=0.0,
    metric='cosine',
    random_state=42,
    verbose=True
)

# Custom HDBSCAN for better control
hdbscan_model = HDBSCAN(
    min_cluster_size=10,
    min_samples=5,
    metric='euclidean',
    cluster_selection_method='eom',
    prediction_data=True
)

# Initialize BERTopic
topic_model = BERTopic(
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    min_topic_size=10,
    nr_topics="auto",
    calculate_probabilities=True,
    verbose=True
)

# Run clustering
print("\n🚀 Running BERTopic clustering...")
print("This will take approximately 20-40 minutes")
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
    print(f"   Smallest topic: {min(topic_counts)} videos")
    print(f"   Largest topic: {max(topic_counts)} videos")
    print(f"   Median topic size: {np.median(topic_counts):.0f} videos")
    print(f"   Average topic size: {np.mean(topic_counts):.0f} videos")
    
    # Save the model
    print("\n💾 Saving BERTopic model...")
    model_path = 'bertopic_model_173k'
    topic_model.save(model_path, serialization="pickle")
    print(f"   Model saved to: {model_path}")
    
    # Save topic assignments
    print("\n💾 Saving topic assignments...")
    assignments = []
    for i, (doc_id, topic, prob) in enumerate(zip(all_ids, topics, probs)):
        assignments.append({
            'video_id': doc_id,
            'topic': int(topic),
            'probability': float(prob[topic] if topic >= 0 else 0),
            'title': all_documents[i]
        })
    
    with open('topic_assignments_173k.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_videos': len(assignments),
            'total_topics': n_topics,
            'outliers': sum(1 for a in assignments if a['topic'] == -1),
            'assignments': assignments
        }, f)
    
    print("   Assignments saved to: topic_assignments_173k.json")
    
    # Save topic information
    print("\n💾 Saving topic information...")
    topic_data = []
    for topic_id in range(n_topics):
        if topic_id >= 0:
            topic_words = topic_model.get_topic(topic_id)
            topic_data.append({
                'topic_id': topic_id,
                'size': len([t for t in topics if t == topic_id]),
                'words': [{'word': word, 'weight': float(weight)} for word, weight in topic_words[:20]]
            })
    
    with open('topic_info_173k.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_topics': n_topics,
            'topics': topic_data
        }, f)
    
    print("   Topic info saved to: topic_info_173k.json")
    
    # Create hierarchical topics
    print("\n🏗️  Creating topic hierarchy...")
    hierarchical_topics = topic_model.hierarchical_topics(all_documents)
    
    # Save hierarchy
    with open('topic_hierarchy_173k.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'linkage_matrix': hierarchical_topics.linkage.tolist() if hasattr(hierarchical_topics, 'linkage') else hierarchical_topics.tolist(),
            'description': 'Hierarchical clustering of topics for 3-level taxonomy'
        }, f)
    
    print("   Hierarchy saved to: topic_hierarchy_173k.json")
    
except Exception as e:
    print(f"\n❌ Error during clustering: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Summary
elapsed_time = time.time() - start_time
print("\n" + "=" * 60)
print("✅ BERTOPIC CLUSTERING COMPLETE!")
print("=" * 60)
print(f"Total time: {elapsed_time/60:.1f} minutes")
print(f"Videos clustered: {len(all_documents):,}")
print(f"Topics discovered: {n_topics}")
print(f"Outlier rate: {sum(1 for t in topics if t == -1)/len(topics)*100:.1f}%")
print(f"\nFiles created:")
print(f"  - bertopic_model_173k/ (model)")
print(f"  - topic_assignments_173k.json")
print(f"  - topic_info_173k.json") 
print(f"  - topic_hierarchy_173k.json")
print(f"\nNext steps:")
print(f"1. Review topic quality in topic_info_173k.json")
print(f"2. Generate semantic names using generate-cluster-names.js")
print(f"3. Save assignments to database")