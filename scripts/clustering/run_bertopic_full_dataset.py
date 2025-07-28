#!/usr/bin/env python3
"""
BERTopic for full 173K dataset - targeting 800-1200 topics
Based on successful monitoring test
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

print("BERTopic Full Dataset - 3-Tier Hierarchy")
print("=" * 60)
print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("Target: 800-1,200 topics for Tier 3")
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

# Configuration based on successful test
print("\n⚙️  Configuration (proven to work):")
print("   Min cluster size: 30")
print("   Algorithm: prims_kdtree")
print("   Approximations: enabled")
print("   Cores: 4 (to prevent deadlock)")

# Progress monitoring
stop_monitoring = False
phase = "Starting"
start_time = time.time()

def monitor_progress():
    """Monitor progress during processing"""
    process = psutil.Process()
    
    while not stop_monitoring:
        cpu = process.cpu_percent(interval=0.5)
        mem = process.memory_info().rss / 1024 / 1024 / 1024  # GB
        elapsed = int(time.time() - start_time)
        
        mins = elapsed // 60
        secs = elapsed % 60
        
        print(f"\r[{mins:02d}:{secs:02d}] {phase:<25} | CPU: {cpu:5.1f}% | RAM: {mem:4.1f}GB", 
              end="", flush=True)
        time.sleep(2)

# Start monitoring
monitor_thread = threading.Thread(target=monitor_progress, daemon=True)
monitor_thread.start()

# UMAP model (same as test)
umap_model = UMAP(
    n_neighbors=15,
    n_components=10,
    min_dist=0.0,
    metric='cosine',
    random_state=42,
    verbose=True
)

# HDBSCAN model (exact same settings that worked)
hdbscan_model = HDBSCAN(
    min_cluster_size=30,
    min_samples=5,
    metric='euclidean',
    algorithm='prims_kdtree',
    core_dist_n_jobs=4,  # Limited cores
    prediction_data=True,  # Changed to True for probabilities
    approx_min_span_tree=True,  # Approximation
    gen_min_span_tree=False  # Skip tree generation
)

# BERTopic model
topic_model = BERTopic(
    umap_model=umap_model,
    hdbscan_model=hdbscan_model,
    min_topic_size=30,
    nr_topics="auto",
    calculate_probabilities=False,  # Changed to False to avoid the error
    verbose=True
)

print("\n🚀 Starting clustering...")
print("Expected time: ~5 minutes based on test")
print("-" * 60)

try:
    # Run clustering
    phase = "BERTopic fit_transform"
    topics, probs = topic_model.fit_transform(all_documents, embeddings_array)
    
    # Stop monitoring
    stop_monitoring = True
    time.sleep(1)
    
    # Get results
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude -1 (outliers)
    n_outliers = sum(1 for t in topics if t == -1)
    
    print(f"\n\n✅ Clustering complete!")
    print(f"   Topics found: {n_topics}")
    print(f"   Outliers: {n_outliers:,} ({n_outliers/len(topics)*100:.1f}%)")
    
    # Analyze topic distribution
    print("\n📊 Topic Size Distribution:")
    topic_counts = topic_info[topic_info.Topic != -1]['Count'].values
    if len(topic_counts) > 0:
        print(f"   Smallest topic: {min(topic_counts)} videos")
        print(f"   Largest topic: {max(topic_counts)} videos")
        print(f"   Median topic size: {np.median(topic_counts):.0f} videos")
        print(f"   Average topic size: {np.mean(topic_counts):.0f} videos")
    
    # Prepare for hierarchy
    print("\n🏗️  Preparing 3-tier hierarchy...")
    
    # Get topic sizes for tier assignment
    topic_sizes = []
    for topic_id in range(n_topics):
        size = len([t for t in topics if t == topic_id])
        if size > 0:
            topic_words = topic_model.get_topic(topic_id)[:5]
            topic_sizes.append({
                'topic_id': topic_id,
                'size': size,
                'top_words': [w[0] for w in topic_words]
            })
    
    # Sort by size for tier assignment
    topic_sizes.sort(key=lambda x: x['size'], reverse=True)
    
    # Assign to tiers based on size
    tier1_topics = topic_sizes[:30]  # Top 30 largest = domains
    tier2_topics = topic_sizes[30:250]  # Next 220 = niches
    tier3_topics = topic_sizes[250:]  # Rest = specific topics
    
    print(f"   Tier 1 (Domains): {len(tier1_topics)} topics")
    print(f"   Tier 2 (Niches): {len(tier2_topics)} topics")
    print(f"   Tier 3 (Topics): {len(tier3_topics)} topics")
    
    # Save model
    print("\n💾 Saving BERTopic model...")
    model_path = 'bertopic_model_full_173k'
    topic_model.save(model_path, serialization="pickle")
    print(f"   Model saved to: {model_path}")
    
    # Save assignments with tier info
    print("\n💾 Saving topic assignments...")
    assignments = []
    
    # Create tier lookup
    tier_lookup = {}
    for t in tier1_topics:
        tier_lookup[t['topic_id']] = 1
    for t in tier2_topics:
        tier_lookup[t['topic_id']] = 2
    for t in tier3_topics:
        tier_lookup[t['topic_id']] = 3
    
    for i, (doc_id, topic) in enumerate(zip(all_ids, topics)):
        prob = probs[i][topic] if topic >= 0 and probs is not None else 0
        tier = tier_lookup.get(topic, 0) if topic >= 0 else 0
        
        assignments.append({
            'video_id': doc_id,
            'topic': int(topic),
            'tier': tier,
            'probability': float(prob),
            'title': all_documents[i]
        })
    
    # Save assignments
    with open('topic_assignments_full_173k.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_videos': len(assignments),
            'total_topics': n_topics,
            'outliers': n_outliers,
            'outlier_percentage': n_outliers/len(topics)*100,
            'tier_counts': {
                'tier_1_domains': len(tier1_topics),
                'tier_2_niches': len(tier2_topics),
                'tier_3_topics': len(tier3_topics)
            },
            'assignments': assignments
        }, f)
    
    print("   Assignments saved to: topic_assignments_full_173k.json")
    
    # Save topic metadata
    print("\n💾 Saving topic metadata...")
    topic_metadata = {
        'generated_at': datetime.now().isoformat(),
        'total_topics': n_topics,
        'tier_1_domains': tier1_topics,
        'tier_2_niches': tier2_topics,
        'tier_3_topics': tier3_topics,
        'all_topics': []
    }
    
    # Add all topic details
    for topic_id in range(n_topics):
        if topic_id >= 0:
            topic_words = topic_model.get_topic(topic_id)
            size = len([t for t in topics if t == topic_id])
            tier = tier_lookup.get(topic_id, 0)
            
            topic_metadata['all_topics'].append({
                'topic_id': topic_id,
                'tier': tier,
                'size': size,
                'words': [{'word': word, 'weight': float(weight)} for word, weight in topic_words[:20]]
            })
    
    with open('topic_metadata_full_173k.json', 'w') as f:
        json.dump(topic_metadata, f, indent=2)
    
    print("   Topic metadata saved")
    
    # Save outliers for future analysis
    print("\n💾 Saving outliers for analysis...")
    outliers = []
    for i, (doc_id, topic) in enumerate(zip(all_ids, topics)):
        if topic == -1:
            outliers.append({
                'video_id': doc_id,
                'title': all_documents[i]
            })
    
    with open('outliers_173k.json', 'w') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'total_outliers': len(outliers),
            'outlier_percentage': len(outliers)/len(topics)*100,
            'outliers': outliers
        }, f)
    
    print(f"   {len(outliers):,} outliers saved for future analysis")
    
except Exception as e:
    stop_monitoring = True
    print(f"\n\n❌ Error: {e}")
    import traceback
    traceback.print_exc()

# Summary
elapsed_time = time.time() - start_time
print("\n" + "=" * 60)
print("✅ FULL CLUSTERING COMPLETE!")
print("=" * 60)
print(f"Total time: {elapsed_time/60:.1f} minutes")
print(f"Videos processed: {len(all_documents):,}")
print(f"Topics discovered: {n_topics}")
print(f"Processing rate: {len(all_documents)/elapsed_time:.0f} videos/second")

print(f"\nFiles created:")
print(f"  - {model_path}/ (BERTopic model)")
print(f"  - topic_assignments_full_173k.json (all assignments with tiers)")
print(f"  - topic_metadata_full_173k.json (topic words and sizes)")
print(f"  - outliers_173k.json (unassigned videos)")

print(f"\nNext steps:")
print(f"1. Review topic quality in topic_metadata_full_173k.json")
print(f"2. Generate semantic names for all {n_topics} topics")
print(f"3. Create tier relationships (which topics belong to which domains)")
print(f"4. Handle {n_outliers:,} outliers with fallback classification")