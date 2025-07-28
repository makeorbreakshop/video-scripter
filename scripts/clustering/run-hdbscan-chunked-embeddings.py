import json
import numpy as np
from datetime import datetime
import hdbscan
from sklearn.preprocessing import normalize
import os
import glob

def load_chunked_embeddings():
    """Load embeddings from chunked files"""
    print("🔍 Looking for embedding chunks...")
    
    # Find the most recent metadata file
    metadata_files = glob.glob('embeddings-metadata-*.json')
    if not metadata_files:
        raise Exception("No metadata files found!")
    
    # Sort by timestamp in filename
    metadata_files.sort(reverse=True)
    metadata_file = metadata_files[0]
    
    print(f"📂 Using metadata file: {metadata_file}")
    
    with open(metadata_file, 'r') as f:
        metadata = json.load(f)
    
    print(f"📊 Found {metadata['chunks']} chunks containing {metadata['embeddings_found']:,} embeddings")
    
    all_embeddings = []
    all_ids = []
    all_metadata = []
    
    # Load each chunk
    for i, chunk_file in enumerate(metadata['files']):
        print(f"  Loading chunk {i+1}/{len(metadata['files'])}: {chunk_file}")
        
        with open(chunk_file, 'r') as f:
            chunk_data = json.load(f)
        
        chunk_embeddings = chunk_data['embeddings']
        
        for item in chunk_embeddings:
            all_ids.append(item['id'])
            all_embeddings.append(item['values'])
            all_metadata.append(item.get('metadata', {}))
        
        print(f"    ✓ Loaded {len(chunk_embeddings):,} embeddings")
    
    print(f"\n✅ Total embeddings loaded: {len(all_embeddings):,}")
    
    # Convert to numpy array
    embeddings_array = np.array(all_embeddings)
    print(f"📐 Embeddings shape: {embeddings_array.shape}")
    
    return embeddings_array, all_ids, all_metadata, metadata

def run_hdbscan_clustering(embeddings, min_cluster_size=10, min_samples=5):
    """Run HDBSCAN clustering on embeddings"""
    print("\n🔬 Running HDBSCAN clustering...")
    print(f"  Parameters: min_cluster_size={min_cluster_size}, min_samples={min_samples}")
    
    # Normalize embeddings
    print("  Normalizing embeddings...")
    normalized_embeddings = normalize(embeddings, norm='l2')
    
    # Initialize HDBSCAN
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True,
        core_dist_n_jobs=-1
    )
    
    # Fit the model
    print("  Fitting HDBSCAN model (this may take a while)...")
    start_time = datetime.now()
    cluster_labels = clusterer.fit_predict(normalized_embeddings)
    end_time = datetime.now()
    
    print(f"  ✓ Clustering completed in {(end_time - start_time).total_seconds():.1f} seconds")
    
    return clusterer, cluster_labels

def analyze_clusters(cluster_labels, video_ids):
    """Analyze the clustering results"""
    print("\n📊 Analyzing cluster results...")
    
    unique_clusters = np.unique(cluster_labels)
    n_clusters = len(unique_clusters[unique_clusters >= 0])
    n_noise = np.sum(cluster_labels == -1)
    
    print(f"  Total clusters found: {n_clusters}")
    print(f"  Noise points: {n_noise:,} ({n_noise/len(cluster_labels)*100:.1f}%)")
    
    # Cluster size distribution
    cluster_sizes = []
    for cluster_id in unique_clusters:
        if cluster_id >= 0:
            size = np.sum(cluster_labels == cluster_id)
            cluster_sizes.append(size)
    
    cluster_sizes.sort(reverse=True)
    
    print("\n📈 Cluster size distribution:")
    print(f"  Largest cluster: {cluster_sizes[0]:,} videos")
    print(f"  Smallest cluster: {cluster_sizes[-1]:,} videos")
    print(f"  Median cluster size: {np.median(cluster_sizes):.0f} videos")
    print(f"  Mean cluster size: {np.mean(cluster_sizes):.1f} videos")
    
    # Show top 10 clusters
    print("\n🔝 Top 10 largest clusters:")
    for i, size in enumerate(cluster_sizes[:10]):
        print(f"  Cluster {i+1}: {size:,} videos")
    
    return {
        'n_clusters': n_clusters,
        'n_noise': n_noise,
        'cluster_sizes': cluster_sizes,
        'unique_clusters': unique_clusters
    }

def save_results(cluster_labels, video_ids, clusterer, analysis_results):
    """Save clustering results"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # Save cluster assignments
    print("\n💾 Saving results...")
    
    assignments = []
    for video_id, cluster_id in zip(video_ids, cluster_labels):
        assignments.append({
            'video_id': video_id,
            'cluster_id': int(cluster_id)
        })
    
    # Save assignments
    output_file = f'hdbscan_assignments_{timestamp}.json'
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': {
                'timestamp': datetime.now().isoformat(),
                'total_videos': len(video_ids),
                'n_clusters': analysis_results['n_clusters'],
                'n_noise': analysis_results['n_noise'],
                'parameters': {
                    'min_cluster_size': clusterer.min_cluster_size,
                    'min_samples': clusterer.min_samples
                }
            },
            'assignments': assignments
        }, f, indent=2)
    
    print(f"  ✓ Saved cluster assignments to: {output_file}")
    
    # Save cluster summary
    summary_file = f'hdbscan_summary_{timestamp}.json'
    cluster_summary = []
    
    for cluster_id in analysis_results['unique_clusters']:
        if cluster_id >= 0:
            cluster_videos = [vid for vid, cid in zip(video_ids, cluster_labels) if cid == cluster_id]
            cluster_summary.append({
                'cluster_id': int(cluster_id),
                'size': len(cluster_videos),
                'sample_videos': cluster_videos[:10]  # First 10 videos as sample
            })
    
    # Sort by size
    cluster_summary.sort(key=lambda x: x['size'], reverse=True)
    
    with open(summary_file, 'w') as f:
        json.dump({
            'metadata': {
                'timestamp': datetime.now().isoformat(),
                'n_clusters': analysis_results['n_clusters'],
                'total_videos': len(video_ids)
            },
            'clusters': cluster_summary
        }, f, indent=2)
    
    print(f"  ✓ Saved cluster summary to: {summary_file}")
    
    return output_file, summary_file

def main():
    print("🚀 HDBSCAN Clustering on Full Dataset")
    print("=" * 50)
    
    try:
        # Load embeddings
        embeddings, video_ids, metadata, file_metadata = load_chunked_embeddings()
        
        # Run clustering with different parameters
        # Start with conservative parameters for large dataset
        min_cluster_size = 50  # Minimum 50 videos per cluster
        min_samples = 10      # Core points need 10 neighbors
        
        clusterer, cluster_labels = run_hdbscan_clustering(
            embeddings, 
            min_cluster_size=min_cluster_size,
            min_samples=min_samples
        )
        
        # Analyze results
        analysis_results = analyze_clusters(cluster_labels, video_ids)
        
        # Save results
        assignments_file, summary_file = save_results(
            cluster_labels, 
            video_ids, 
            clusterer, 
            analysis_results
        )
        
        print("\n✅ Clustering complete!")
        print(f"   Assignments: {assignments_file}")
        print(f"   Summary: {summary_file}")
        
        # Try another run with different parameters if clusters are too large
        if analysis_results['cluster_sizes'][0] > 5000:
            print("\n🔄 Running again with smaller min_cluster_size for more granularity...")
            
            min_cluster_size = 20  # Smaller clusters
            min_samples = 5
            
            clusterer2, cluster_labels2 = run_hdbscan_clustering(
                embeddings, 
                min_cluster_size=min_cluster_size,
                min_samples=min_samples
            )
            
            analysis_results2 = analyze_clusters(cluster_labels2, video_ids)
            
            assignments_file2, summary_file2 = save_results(
                cluster_labels2, 
                video_ids, 
                clusterer2, 
                analysis_results2
            )
            
            print(f"\n✅ Second clustering complete!")
            print(f"   Assignments: {assignments_file2}")
            print(f"   Summary: {summary_file2}")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()