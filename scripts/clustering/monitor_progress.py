#!/usr/bin/env python3
"""
Monitor HDBSCAN clustering progress by checking output files
"""
import os
import json
import time
from datetime import datetime
import glob

def check_progress():
    print("Monitoring HDBSCAN progress...\n")
    
    # Check for result files
    result_files = sorted(glob.glob('hdbscan_results_*.json'))
    
    if result_files:
        print(f"Completed runs: {len(result_files)}/4")
        print("-" * 50)
        
        for file in result_files:
            with open(file, 'r') as f:
                data = json.load(f)
            
            print(f"File: {os.path.basename(file)}")
            print(f"  Parameters: min_cluster_size={data['params']['min_cluster_size']}, "
                  f"min_samples={data['params']['min_samples']}")
            print(f"  Clusters found: {data['n_clusters']}")
            print(f"  Noise points: {data['n_noise']} ({data['n_noise']/data['n_videos']*100:.1f}%)")
            print()
    else:
        print("No completed runs yet...")
    
    # Check process
    import subprocess
    try:
        result = subprocess.run(['pgrep', '-f', 'run_hdbscan_clustering.py'], 
                              capture_output=True, text=True)
        if result.stdout.strip():
            print("\n✓ HDBSCAN process is still running")
            
            # Get memory usage
            pid = result.stdout.strip()
            mem_result = subprocess.run(['ps', '-o', 'rss=', '-p', pid], 
                                      capture_output=True, text=True)
            if mem_result.stdout:
                mem_mb = int(mem_result.stdout.strip()) / 1024
                print(f"  Memory usage: {mem_mb:.0f} MB")
        else:
            print("\n✗ HDBSCAN process not found - may have completed")
    except:
        pass
    
    print(f"\nLast checked: {datetime.now().strftime('%H:%M:%S')}")

if __name__ == "__main__":
    try:
        while True:
            os.system('clear')  # Clear screen
            check_progress()
            time.sleep(10)  # Check every 10 seconds
    except KeyboardInterrupt:
        print("\nStopped monitoring")