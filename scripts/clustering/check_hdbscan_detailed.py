#!/usr/bin/env python3
"""
Detailed check of HDBSCAN status
"""
import os
import time
import numpy as np
import hdbscan

# Test with tiny subset
print("Testing HDBSCAN with 1000 samples...")
start = time.time()

# Create random data
test_data = np.random.rand(1000, 512)

clusterer = hdbscan.HDBSCAN(
    min_cluster_size=10,
    min_samples=5,
    metric='euclidean',
    cluster_selection_method='eom',
    prediction_data=True,
    core_dist_n_jobs=-1
)

labels = clusterer.fit_predict(test_data)
elapsed = time.time() - start

print(f"Test completed in {elapsed:.1f} seconds")
print(f"Found {len(set(labels)) - (1 if -1 in labels else 0)} clusters")

# Estimate for full dataset
scale_factor = 170860 / 1000
estimated_time = elapsed * (scale_factor ** 1.5)  # Superlinear scaling
print(f"\nEstimated time for 170K samples: {estimated_time/60:.1f} minutes")

# Check CPU cores
import multiprocessing
print(f"\nCPU cores available: {multiprocessing.cpu_count()}")

# Check if process is actually stuck
import subprocess
result = subprocess.run(['ps', 'aux'], capture_output=True, text=True)
for line in result.stdout.split('\n'):
    if 'run_hdbscan_clustering.py' in line and 'grep' not in line:
        print(f"\nProcess info: {line}")
        
print("\nIf this test runs quickly but the main process is stuck, try:")
print("1. Kill the current process: pkill -f run_hdbscan_clustering.py")
print("2. Run with smaller test: Modify the script to use only first 10K embeddings")