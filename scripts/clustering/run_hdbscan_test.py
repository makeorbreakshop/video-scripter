#!/usr/bin/env python3
"""
Test HDBSCAN with 30K embeddings and reasonable parameters
"""
import json
import numpy as np
import hdbscan
from datetime import datetime
import time

def load_test_embeddings(max_videos=30000):
    """Load up to max_videos embeddings"""
    print(f"Loading up to {max_videos} embeddings...")
    
    all_embeddings = []
    all_ids = []
    all_titles = []
    
    # Load from first 3 files (about 30K embeddings)
    for i in range(1, 4):
        filename = f'embeddings-part-{i}.json'
        print(f"Loading {filename}...")
        
        with open(filename, 'r') as f:
            data = json.load(f)
        
        for emb in data['embeddings']:
            if len(all_embeddings) >= max_videos:
                break
            all_embeddings.append(emb['values'])
            all_ids.append(emb['id'])
            all_titles.append(emb.get('metadata', {}).get('title', 'Unknown'))
    
    embeddings_array = np.array(all_embeddings)
    print(f"Loaded {len(all_embeddings)} embeddings\n")
    
    return embeddings_array, all_ids, all_titles

def test_clustering():
    # Load test data
    embeddings, ids, titles = load_test_embeddings(30000)
    
    # Test with reasonable parameters for 30K
    test_params = [
        {'min_cluster_size': 100, 'min_samples': 50},  # Start conservative
        {'min_cluster_size': 50, 'min_samples': 25},   # Medium
        {'min_cluster_size': 30, 'min_samples': 15},   # More granular
    ]
    
    best_result = None
    best_score = -1
    
    for params in test_params:
        print("="*60)
        print(f"Testing min_cluster_size={params['min_cluster_size']}, min_samples={params['min_samples']}")
        
        start_time = time.time()
        
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=params['min_cluster_size'],
            min_samples=params['min_samples'],
            metric='euclidean',
            cluster_selection_method='eom',
            core_dist_n_jobs=-1
        )
        
        labels = clusterer.fit_predict(embeddings)
        elapsed = time.time() - start_time
        
        # Get statistics
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        n_noise = list(labels).count(-1)
        
        print(f"Completed in {elapsed:.1f} seconds")
        print(f"Found {n_clusters} clusters")
        print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")
        
        if n_clusters > 0:
            # Show cluster sizes
            cluster_sizes = {}
            for label in labels:
                if label != -1:
                    cluster_sizes[label] = cluster_sizes.get(label, 0) + 1
            
            sizes = sorted(cluster_sizes.values(), reverse=True)
            print(f"Largest clusters: {sizes[:5]}")
            print(f"Smallest clusters: {sizes[-5:]}")
            
            # Show sample from largest cluster
            largest_cluster = max(cluster_sizes, key=cluster_sizes.get)
            print(f"\nSample from largest cluster ({cluster_sizes[largest_cluster]} videos):")
            
            cluster_indices = [i for i, l in enumerate(labels) if l == largest_cluster][:5]
            for idx in cluster_indices:
                print(f"  - {titles[idx][:80]}")
            
            # Simple quality score (prefer more clusters with reasonable noise)
            score = n_clusters - (n_noise / len(labels)) * 50
            if score > best_score:
                best_score = score
                best_result = {
                    'params': params,
                    'n_clusters': n_clusters,
                    'noise_pct': n_noise/len(labels)*100
                }
    
    print("\n" + "="*60)
    if best_result:
        print(f"Best result: {best_result['n_clusters']} clusters with {best_result['noise_pct']:.1f}% noise")
        print(f"Parameters: {best_result['params']}")
    
    # Save test results
    results = {
        'test_size': len(embeddings),
        'best_params': best_result['params'] if best_result else None,
        'timestamp': datetime.now().isoformat()
    }
    
    with open('hdbscan_test_results.json', 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\nTest results saved to hdbscan_test_results.json")

if __name__ == "__main__":
    test_clustering()