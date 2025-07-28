"""
Run HDBSCAN clustering on aggregated title embeddings
Simple version that focuses on the clustering
"""

import json
import numpy as np
import hdbscan
from datetime import datetime
import pickle
from tqdm import tqdm
import os

def run_clustering():
    # Load embeddings
    print("📂 Loading embeddings...")
    embeddings_file = '/Users/brandoncullum/video-scripter/exports/title-embeddings-complete-aggregated.json'
    
    with open(embeddings_file, 'r') as f:
        data = json.load(f)
    
    print(f"✅ Loaded data with {len(data['embeddings'])} embeddings")
    
    # Extract embeddings and metadata
    embeddings = []
    metadata = []
    
    for item in tqdm(data['embeddings'], desc="Processing embeddings"):
        if 'values' in item and len(item['values']) == 512:
            embeddings.append(item['values'])
            metadata.append({
                'id': item['id'],
                'title': item.get('metadata', {}).get('title', ''),
                'channel_name': item.get('metadata', {}).get('channel_name', ''),
                'view_count': item.get('metadata', {}).get('view_count', 0),
                'topic_cluster': item.get('metadata', {}).get('topic_cluster')
            })
    
    embeddings_array = np.array(embeddings)
    print(f"\n✅ Prepared {len(embeddings)} embeddings for clustering")
    
    # Run HDBSCAN with reasonable parameters
    print("\n🚀 Running HDBSCAN clustering...")
    min_cluster_size = 50  # Reasonable for 50K dataset
    min_samples = 10
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True,
        core_dist_n_jobs=-1  # Use all CPU cores
    )
    
    cluster_labels = clusterer.fit_predict(embeddings_array)
    
    # Calculate statistics
    n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    n_noise = list(cluster_labels).count(-1)
    noise_ratio = n_noise / len(cluster_labels)
    
    print(f"\n📊 Clustering Results:")
    print(f"   Total clusters: {n_clusters}")
    print(f"   Noise points: {n_noise:,} ({noise_ratio:.1%})")
    
    # Analyze top clusters
    from collections import Counter
    cluster_sizes = Counter(cluster_labels)
    del cluster_sizes[-1]  # Remove noise
    
    print(f"\n📈 Top 10 Clusters by Size:")
    for cluster_id, size in cluster_sizes.most_common(10):
        # Get videos in this cluster
        cluster_indices = [i for i, label in enumerate(cluster_labels) if label == cluster_id]
        sample_titles = [metadata[i]['title'] for i in cluster_indices[:3]]
        
        print(f"\n   Cluster {cluster_id}: {size} videos")
        for title in sample_titles:
            print(f"      - {title[:70]}...")
    
    # Save results
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    
    # Save cluster assignments
    assignments = []
    for i, (label, meta) in enumerate(zip(cluster_labels, metadata)):
        assignments.append({
            'video_id': meta['id'],
            'title': meta['title'],
            'channel_name': meta['channel_name'],
            'hdbscan_cluster_id': int(label),
            'existing_topic_cluster': meta['topic_cluster']
        })
    
    output_file = f'hdbscan_clusters_{timestamp}.json'
    with open(output_file, 'w') as f:
        json.dump({
            'clustering_info': {
                'timestamp': datetime.now().isoformat(),
                'total_videos': len(assignments),
                'n_clusters': n_clusters,
                'noise_ratio': noise_ratio,
                'min_cluster_size': min_cluster_size,
                'min_samples': min_samples
            },
            'assignments': assignments
        }, f, indent=2)
    
    print(f"\n💾 Saved cluster assignments to: {output_file}")
    
    # Save model
    model_file = f'hdbscan_model_{timestamp}.pkl'
    with open(model_file, 'wb') as f:
        pickle.dump({
            'clusterer': clusterer,
            'metadata': metadata,
            'cluster_labels': cluster_labels
        }, f)
    
    print(f"💾 Saved model to: {model_file}")
    print("\n🎉 HDBSCAN clustering complete!")

if __name__ == "__main__":
    run_clustering()