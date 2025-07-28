"""
Run HDBSCAN clustering on all video title embeddings
Uses the exported embeddings from all-title-embeddings-from-db.json
"""

import os
import json
import numpy as np
import hdbscan
from datetime import datetime
from collections import Counter
import pickle
from tqdm import tqdm

def load_embeddings_from_json(filepath):
    """Load embeddings from JSON file with progress tracking"""
    print(f"📂 Loading embeddings from {filepath}...")
    
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    # Handle different JSON structures
    if isinstance(data, dict) and 'videos' in data:
        videos = data['videos']
        print(f"✅ Loaded {len(videos)} videos from export")
        export_info = data.get('export_info', {})
        if export_info:
            print(f"   Export timestamp: {export_info.get('timestamp')}")
            print(f"   Total videos in DB: {export_info.get('total_videos')}")
    else:
        videos = data
        print(f"✅ Loaded {len(videos)} videos")
    
    # Extract embeddings and metadata
    embeddings = []
    metadata = []
    missing_embeddings = 0
    
    for item in tqdm(videos, desc="Processing embeddings"):
        # Handle the aggregated file structure
        if 'values' in item:  # Aggregated format
            embedding = item['values']
            video_metadata = item.get('metadata', {})
            
            if len(embedding) == 512:  # Ensure correct dimension
                embeddings.append(embedding)
                metadata.append({
                    'id': item['id'],
                    'title': video_metadata.get('title', ''),
                    'channel_id': video_metadata.get('channel_id'),
                    'channel_name': video_metadata.get('channel_name'),
                    'view_count': video_metadata.get('view_count', 0),
                    'topic_cluster': video_metadata.get('topic_cluster'),
                    'topic_level_3': video_metadata.get('topic_level_3')
                })
            else:
                missing_embeddings += 1
        else:
            # Try other field names for embeddings
            embedding = None
            for field in ['embedding', 'title_embedding', 'embeddings']:
                if field in item and item[field]:
                    embedding = item[field]
                    break
            
            if embedding:
                # Parse embedding if it's a string
                if isinstance(embedding, str):
                    try:
                        embedding = json.loads(embedding)
                    except:
                        continue
                
                if len(embedding) == 512:  # Ensure correct dimension
                    embeddings.append(embedding)
                    metadata.append({
                        'id': item['id'],
                        'title': item.get('title', ''),
                        'channel_id': item.get('channel_id'),
                        'channel_name': item.get('channel_name'),
                        'view_count': item.get('view_count', 0),
                        'topic_cluster': item.get('topic_cluster'),
                        'topic_level_3': item.get('topic_level_3')
                    })
            else:
                missing_embeddings += 1
    
    embeddings_array = np.array(embeddings)
    print(f"✅ Processed {len(embeddings)} valid embeddings")
    if missing_embeddings > 0:
        print(f"⚠️  Missing embeddings for {missing_embeddings} videos")
    
    return embeddings_array, metadata

def find_optimal_parameters(embeddings_subset):
    """Test different parameter combinations on a subset"""
    print("\n🔬 Finding optimal HDBSCAN parameters...")
    
    results = []
    
    # Test different min_cluster_size values
    min_cluster_sizes = [30, 50, 100, 150]
    min_samples_values = [5, 10, 20]
    
    for min_cluster_size in min_cluster_sizes:
        for min_samples in min_samples_values:
            clusterer = hdbscan.HDBSCAN(
                min_cluster_size=min_cluster_size,
                min_samples=min_samples,
                metric='euclidean',
                cluster_selection_method='eom',
                core_dist_n_jobs=-1  # Use all CPU cores
            )
            
            labels = clusterer.fit_predict(embeddings_subset)
            n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
            n_noise = list(labels).count(-1)
            noise_ratio = n_noise / len(labels)
            
            result = {
                'min_cluster_size': min_cluster_size,
                'min_samples': min_samples,
                'n_clusters': n_clusters,
                'noise_ratio': noise_ratio
            }
            results.append(result)
            
            print(f"   min_cluster_size={min_cluster_size}, min_samples={min_samples}: "
                  f"{n_clusters} clusters, {noise_ratio:.1%} noise")
    
    # Find best parameters (balance between clusters and noise)
    best = min(results, key=lambda x: abs(x['noise_ratio'] - 0.15) + abs(x['n_clusters'] - 2000) / 10000)
    print(f"\n✅ Optimal parameters: min_cluster_size={best['min_cluster_size']}, min_samples={best['min_samples']}")
    
    return best['min_cluster_size'], best['min_samples']

def run_full_clustering(embeddings, metadata, min_cluster_size=50, min_samples=10):
    """Run HDBSCAN on full dataset"""
    print(f"\n🚀 Running HDBSCAN on {len(embeddings):,} embeddings...")
    print(f"   Parameters: min_cluster_size={min_cluster_size}, min_samples={min_samples}")
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True,  # For future predictions
        core_dist_n_jobs=-1    # Use all CPU cores
    )
    
    # Fit the model
    cluster_labels = clusterer.fit_predict(embeddings)
    
    # Calculate statistics
    n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    n_noise = list(cluster_labels).count(-1)
    noise_ratio = n_noise / len(cluster_labels)
    
    print(f"\n📊 Clustering Results:")
    print(f"   Total clusters: {n_clusters}")
    print(f"   Noise points: {n_noise:,} ({noise_ratio:.1%})")
    
    # Analyze cluster sizes
    cluster_sizes = Counter(cluster_labels)
    del cluster_sizes[-1]  # Remove noise count
    
    print(f"\n📈 Cluster Size Distribution:")
    print(f"   Largest cluster: {max(cluster_sizes.values()):,} videos")
    print(f"   Smallest cluster: {min(cluster_sizes.values()):,} videos")
    print(f"   Median cluster size: {np.median(list(cluster_sizes.values())):.0f} videos")
    
    # Save the model for future use
    model_data = {
        'clusterer': clusterer,
        'cluster_labels': cluster_labels,
        'metadata': metadata,
        'parameters': {
            'min_cluster_size': min_cluster_size,
            'min_samples': min_samples,
            'n_clusters': n_clusters,
            'noise_ratio': noise_ratio
        },
        'timestamp': datetime.now().isoformat()
    }
    
    # Save as pickle file
    output_file = f'hdbscan_model_{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}.pkl'
    with open(output_file, 'wb') as f:
        pickle.dump(model_data, f)
    
    print(f"\n💾 Model saved to: {output_file}")
    
    return clusterer, cluster_labels

def analyze_clusters(cluster_labels, metadata):
    """Analyze the resulting clusters"""
    print("\n🔍 Analyzing clusters...")
    
    # Group videos by cluster
    clusters = {}
    for i, label in enumerate(cluster_labels):
        if label != -1:  # Skip noise
            if label not in clusters:
                clusters[label] = []
            clusters[label].append(metadata[i])
    
    # Analyze top clusters
    print("\n📋 Top 20 Clusters by Size:")
    sorted_clusters = sorted(clusters.items(), key=lambda x: len(x[1]), reverse=True)
    
    for cluster_id, videos in sorted_clusters[:20]:
        # Get sample titles
        sample_titles = [v['title'] for v in videos[:5]]
        
        # Calculate average views
        avg_views = np.mean([v['view_count'] or 0 for v in videos])
        
        # Count unique channels
        unique_channels = len(set(v['channel_id'] for v in videos if v['channel_id']))
        
        print(f"\n   Cluster {cluster_id}: {len(videos)} videos, {unique_channels} channels, {avg_views:,.0f} avg views")
        for title in sample_titles[:3]:
            print(f"      - {title[:80]}...")
    
    # Compare with existing topics
    print("\n🔄 Comparison with Existing BERT Topics:")
    
    # Count how BERT topics distribute across HDBSCAN clusters
    bert_to_hdbscan = {}
    for i, video in enumerate(metadata):
        if cluster_labels[i] != -1 and video['topic_level_3']:
            bert_topic = video['topic_level_3']
            hdbscan_cluster = cluster_labels[i]
            
            if bert_topic not in bert_to_hdbscan:
                bert_to_hdbscan[bert_topic] = Counter()
            bert_to_hdbscan[bert_topic][hdbscan_cluster] += 1
    
    # Find BERT topics that split into multiple clusters
    split_topics = [(topic, len(clusters)) for topic, clusters in bert_to_hdbscan.items() if len(clusters) > 1]
    split_topics.sort(key=lambda x: x[1], reverse=True)
    
    print(f"\n   BERT topics that split across multiple HDBSCAN clusters:")
    for topic, n_clusters in split_topics[:10]:
        print(f"      {topic}: split into {n_clusters} clusters")
    
    # Save detailed analysis
    analysis = {
        'n_clusters': len(clusters),
        'cluster_sizes': {k: len(v) for k, v in clusters.items()},
        'bert_topic_splits': {topic: dict(clusters) for topic, clusters in bert_to_hdbscan.items()},
        'timestamp': datetime.now().isoformat()
    }
    
    with open(f'cluster_analysis_{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}.json', 'w') as f:
        json.dump(analysis, f, indent=2)
    
    print("\n✅ Detailed analysis saved!")

def main():
    # Load embeddings - use the complete aggregated file
    embeddings_file = '/Users/brandoncullum/video-scripter/exports/title-embeddings-complete-aggregated.json'
    
    print(f"🎯 Using embeddings file: {embeddings_file}")
    embeddings, metadata = load_embeddings_from_json(embeddings_file)
    
    # Test parameters on subset
    subset_size = min(10000, len(embeddings))
    indices = np.random.choice(len(embeddings), subset_size, replace=False)
    embeddings_subset = embeddings[indices]
    
    min_cluster_size, min_samples = find_optimal_parameters(embeddings_subset)
    
    # Run full clustering
    clusterer, cluster_labels = run_full_clustering(embeddings, metadata, min_cluster_size, min_samples)
    
    # Analyze results
    analyze_clusters(cluster_labels, metadata)
    
    print("\n🎉 HDBSCAN clustering complete!")
    
    # Export cluster assignments
    cluster_assignments = []
    for i, (label, video) in enumerate(zip(cluster_labels, metadata)):
        cluster_assignments.append({
            'video_id': video['id'],
            'title': video['title'],
            'channel_id': video['channel_id'],
            'hdbscan_cluster_id': int(label),
            'bert_topic': video['topic_level_3']
        })
    
    output_file = f'hdbscan_cluster_assignments_{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}.json'
    with open(output_file, 'w') as f:
        json.dump(cluster_assignments, f, indent=2)
    
    print(f"\n📄 Cluster assignments exported to: {output_file}")

if __name__ == "__main__":
    # Install required packages
    print("📦 Installing required packages...")
    os.system("pip install hdbscan tqdm numpy")
    
    main()