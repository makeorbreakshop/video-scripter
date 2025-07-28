#!/usr/bin/env python3
"""
Test HDBSCAN performance with different configurations
"""
import numpy as np
from sklearn.datasets import make_blobs
from hdbscan import HDBSCAN
import time

print("Testing HDBSCAN performance...")

# Test different sizes
sizes = [1000, 5000, 10000, 50000]

for n_samples in sizes:
    print(f"\n{'='*50}")
    print(f"Testing with {n_samples:,} samples (10D)")
    
    # Generate synthetic data similar to UMAP output
    X, _ = make_blobs(n_samples=n_samples, 
                      n_features=10, 
                      centers=int(n_samples/50),
                      random_state=42)
    
    # Test different HDBSCAN parameters
    configs = [
        {"min_cluster_size": 10, "min_samples": 5, "algorithm": "best"},
        {"min_cluster_size": 50, "min_samples": 5, "algorithm": "best"},
        {"min_cluster_size": 10, "min_samples": 5, "algorithm": "prims_kdtree"},
        {"min_cluster_size": 10, "min_samples": 5, "algorithm": "prims_balltree"},
    ]
    
    for config in configs:
        print(f"\nConfig: {config}")
        clusterer = HDBSCAN(**config)
        
        start = time.time()
        labels = clusterer.fit_predict(X)
        elapsed = time.time() - start
        
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        print(f"  Time: {elapsed:.2f}s | Clusters: {n_clusters}")
        
        # Estimate time for 173K samples
        est_time = elapsed * (173000 / n_samples) ** 1.5  # Non-linear scaling
        print(f"  Estimated for 173K: {est_time/60:.1f} minutes")

print("\n" + "="*50)
print("Recommendation: If estimates show >20 minutes, consider:")
print("1. Increase min_cluster_size to 50 or 100")
print("2. Use algorithm='prims_kdtree' explicitly")
print("3. Subsample to 50K points for initial clustering")