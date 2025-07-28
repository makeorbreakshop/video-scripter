#!/usr/bin/env python3
"""
Run HDBSCAN clustering on extracted embeddings
"""
import json
import glob
import numpy as np
import hdbscan
from datetime import datetime
import time
import os
import psycopg2
from psycopg2.extras import execute_values
from dotenv import load_dotenv
import threading

# Load environment variables
load_dotenv()

def load_embeddings():
    """Load all embedding parts and combine them"""
    print("Loading embeddings from parts...")
    files = sorted(glob.glob('embeddings-part-*.json'))
    
    all_embeddings = []
    all_ids = []
    all_metadata = []
    
    for file in files:
        print(f"Loading {file}...")
        with open(file, 'r') as f:
            data = json.load(f)
            
        for emb in data['embeddings']:
            all_ids.append(emb['id'])
            all_embeddings.append(emb['values'])
            all_metadata.append(emb.get('metadata', {}))
    
    embeddings_array = np.array(all_embeddings)
    print(f"Loaded {len(all_embeddings)} embeddings with shape {embeddings_array.shape}")
    
    return embeddings_array, all_ids, all_metadata

def run_clustering(embeddings, min_cluster_size=10, min_samples=5):
    """Run HDBSCAN clustering"""
    print(f"\nRunning HDBSCAN with min_cluster_size={min_cluster_size}, min_samples={min_samples}")
    print("This typically takes 2-5 minutes...")
    
    start_time = time.time()
    
    # Show progress dots
    import threading
    stop_progress = False
    def show_progress():
        while not stop_progress:
            print(".", end="", flush=True)
            time.sleep(2)
    
    progress_thread = threading.Thread(target=show_progress)
    progress_thread.start()
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',  # Excess of Mass
        prediction_data=True,  # For future predictions
        core_dist_n_jobs=-1,  # Use all CPU cores
    )
    
    labels = clusterer.fit_predict(embeddings)
    
    # Stop progress dots
    stop_progress = True
    progress_thread.join()
    print()  # New line after dots
    
    elapsed = time.time() - start_time
    print(f"Clustering completed in {elapsed:.1f} seconds")
    
    # Get statistics
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = list(labels).count(-1)
    
    print(f"Found {n_clusters} clusters")
    print(f"Noise points: {n_noise} ({n_noise/len(labels)*100:.1f}%)")
    
    # Cluster sizes
    cluster_sizes = {}
    for label in labels:
        if label != -1:
            cluster_sizes[label] = cluster_sizes.get(label, 0) + 1
    
    if cluster_sizes:
        sizes = list(cluster_sizes.values())
        print(f"Cluster sizes: min={min(sizes)}, max={max(sizes)}, median={np.median(sizes):.0f}")
    
    return clusterer, labels

def save_results(video_ids, labels, metadata, clusterer, params):
    """Save clustering results to database and files"""
    # Save to JSON for backup
    results = {
        'timestamp': datetime.now().isoformat(),
        'params': params,
        'n_videos': len(video_ids),
        'n_clusters': len(set(labels)) - (1 if -1 in labels else 0),
        'n_noise': list(labels).count(-1),
        'cluster_assignments': []
    }
    
    for i, (video_id, label) in enumerate(zip(video_ids, labels)):
        results['cluster_assignments'].append({
            'video_id': video_id,
            'cluster_id': int(label),
            'title': metadata[i].get('title', ''),
            'channel_title': metadata[i].get('channel_title', '')
        })
    
    filename = f"hdbscan_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(filename, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to {filename}")
    
    # Save to database
    try:
        conn = psycopg2.connect(os.getenv('DATABASE_URL'))
        cur = conn.cursor()
        
        # Create results table if it doesn't exist
        cur.execute("""
            CREATE TABLE IF NOT EXISTS hdbscan_results (
                id SERIAL PRIMARY KEY,
                video_id VARCHAR(20) NOT NULL,
                cluster_id INTEGER NOT NULL,
                run_timestamp TIMESTAMP DEFAULT NOW(),
                params JSONB,
                UNIQUE(video_id, run_timestamp)
            )
        """)
        
        # Insert results
        values = [
            (video_id, int(label), json.dumps(params))
            for video_id, label in zip(video_ids, labels)
        ]
        
        execute_values(
            cur,
            """
            INSERT INTO hdbscan_results (video_id, cluster_id, params)
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            values
        )
        
        conn.commit()
        print(f"Saved {cur.rowcount} results to database")
        
        cur.close()
        conn.close()
        
    except Exception as e:
        print(f"Error saving to database: {e}")
    
    return filename

def main():
    # Load embeddings
    embeddings, video_ids, metadata = load_embeddings()
    
    # Test different parameter combinations
    param_combinations = [
        {'min_cluster_size': 10, 'min_samples': 5},
        {'min_cluster_size': 20, 'min_samples': 10},
        {'min_cluster_size': 50, 'min_samples': 25},
        {'min_cluster_size': 100, 'min_samples': 50},
    ]
    
    best_result = None
    best_score = -1
    
    for params in param_combinations:
        print("\n" + "="*60)
        clusterer, labels = run_clustering(
            embeddings,
            min_cluster_size=params['min_cluster_size'],
            min_samples=params['min_samples']
        )
        
        # Calculate silhouette score for non-noise points
        valid_mask = labels != -1
        if np.sum(valid_mask) > 0:
            from sklearn.metrics import silhouette_score
            score = silhouette_score(embeddings[valid_mask], labels[valid_mask])
            print(f"Silhouette score: {score:.3f}")
            
            if score > best_score:
                best_score = score
                best_result = (clusterer, labels, params)
        
        # Save results
        save_results(video_ids, labels, metadata, clusterer, params)
    
    print("\n" + "="*60)
    print(f"Best parameters: {best_result[2]} with score {best_score:.3f}")
    
    # Save best result
    if best_result:
        clusterer, labels, params = best_result
        # Save clusterer for future predictions
        import joblib
        joblib.dump(clusterer, 'best_hdbscan_model.pkl')
        print("\nBest model saved to best_hdbscan_model.pkl")

if __name__ == "__main__":
    main()