#!/usr/bin/env python3
"""
HDBSCAN Partial Clustering
Performs clustering on a subset of videos for incremental updates
"""

import json
import argparse
import numpy as np
import hdbscan
from sklearn.preprocessing import StandardScaler
import warnings
warnings.filterwarnings('ignore')

def load_data(input_path):
    """Load video data with embeddings"""
    with open(input_path, 'r') as f:
        data = json.load(f)
    
    videos = []
    embeddings = []
    
    for item in data:
        videos.append({
            'id': item['id'],
            'title': item['title'],
            'original_cluster': item.get('original_cluster')
        })
        embeddings.append(item['embedding'])
    
    return videos, np.array(embeddings)

def perform_clustering(embeddings, min_cluster_size=30, min_samples=5):
    """Perform HDBSCAN clustering on embeddings"""
    print(f"Clustering {len(embeddings)} videos...")
    print(f"Parameters: min_cluster_size={min_cluster_size}, min_samples={min_samples}")
    
    # Standardize embeddings
    scaler = StandardScaler()
    embeddings_scaled = scaler.fit_transform(embeddings)
    
    # Initialize HDBSCAN with soft clustering
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True,
        core_dist_n_jobs=-1
    )
    
    # Fit the model
    cluster_labels = clusterer.fit_predict(embeddings_scaled)
    
    # Get soft cluster memberships
    soft_clusters = hdbscan.all_points_membership_vectors(clusterer)
    
    # Get probabilities
    probabilities = clusterer.probabilities_
    
    # Calculate statistics
    n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    n_noise = list(cluster_labels).count(-1)
    
    print(f"Found {n_clusters} clusters")
    print(f"Noise points: {n_noise} ({n_noise/len(cluster_labels)*100:.1f}%)")
    
    return cluster_labels, probabilities, soft_clusters, clusterer

def calculate_cluster_stability(videos, cluster_labels, original_clusters):
    """Calculate how stable the new clustering is compared to original"""
    stability_scores = {}
    
    # Group videos by new cluster
    new_clusters = {}
    for i, label in enumerate(cluster_labels):
        if label == -1:
            continue
        if label not in new_clusters:
            new_clusters[label] = []
        new_clusters[label].append(i)
    
    # Calculate stability for each new cluster
    for new_label, indices in new_clusters.items():
        # Count original cluster memberships
        original_counts = {}
        for idx in indices:
            orig = videos[idx].get('original_cluster')
            if orig is not None:
                original_counts[orig] = original_counts.get(orig, 0) + 1
        
        # Calculate stability as ratio of most common original cluster
        if original_counts:
            max_count = max(original_counts.values())
            stability = max_count / len(indices)
            most_common_original = max(original_counts, key=original_counts.get)
        else:
            stability = 0
            most_common_original = None
        
        stability_scores[new_label] = {
            'stability': stability,
            'size': len(indices),
            'most_common_original': most_common_original,
            'original_distribution': original_counts
        }
    
    return stability_scores

def save_results(output_path, videos, cluster_labels, probabilities, stability_scores):
    """Save clustering results"""
    results = []
    
    for i, video in enumerate(videos):
        result = {
            'id': video['id'],
            'title': video['title'],
            'original_cluster': video.get('original_cluster'),
            'new_cluster': int(cluster_labels[i]),
            'confidence': float(probabilities[i]) if cluster_labels[i] != -1 else 0.0
        }
        
        # Add stability info if available
        if cluster_labels[i] != -1 and cluster_labels[i] in stability_scores:
            result['cluster_stability'] = stability_scores[cluster_labels[i]]['stability']
        
        results.append(result)
    
    # Save results
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    # Print summary
    print(f"\nResults saved to: {output_path}")
    print("\nCluster stability summary:")
    for cluster_id, stats in sorted(stability_scores.items()):
        print(f"  Cluster {cluster_id}: {stats['size']} videos, "
              f"stability={stats['stability']:.2f}, "
              f"maps to original cluster {stats['most_common_original']}")

def main():
    parser = argparse.ArgumentParser(description='Perform partial HDBSCAN clustering')
    parser.add_argument('--input', required=True, help='Input JSON file with video data')
    parser.add_argument('--output', required=True, help='Output JSON file for results')
    parser.add_argument('--min_cluster_size', type=int, default=30, help='Minimum cluster size')
    parser.add_argument('--min_samples', type=int, default=5, help='Minimum samples')
    
    args = parser.parse_args()
    
    # Load data
    videos, embeddings = load_data(args.input)
    print(f"Loaded {len(videos)} videos with {embeddings.shape[1]}-dimensional embeddings")
    
    # Perform clustering
    cluster_labels, probabilities, soft_clusters, clusterer = perform_clustering(
        embeddings, 
        min_cluster_size=args.min_cluster_size,
        min_samples=args.min_samples
    )
    
    # Calculate stability scores
    original_clusters = [v.get('original_cluster') for v in videos]
    stability_scores = calculate_cluster_stability(videos, cluster_labels, original_clusters)
    
    # Save results
    save_results(args.output, videos, cluster_labels, probabilities, stability_scores)

if __name__ == '__main__':
    main()