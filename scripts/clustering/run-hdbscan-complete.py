import json
import numpy as np
from datetime import datetime
import hdbscan
from sklearn.preprocessing import normalize
import os

def load_embeddings():
    """Load embeddings from the aggregated file"""
    print("🔍 Loading embeddings from aggregated file...")
    
    # Load from the exports directory
    embeddings_file = '/Users/brandoncullum/video-scripter/exports/title-embeddings-complete-aggregated.json'
    
    if not os.path.exists(embeddings_file):
        raise Exception(f"Embeddings file not found: {embeddings_file}")
    
    print(f"📂 Loading from: {embeddings_file}")
    
    with open(embeddings_file, 'r') as f:
        data = json.load(f)
    
    print(f"📊 File contains {len(data['embeddings']):,} embeddings")
    
    all_embeddings = []
    all_ids = []
    all_metadata = []
    
    # Process embeddings
    for item in data['embeddings']:
        if 'values' in item:  # Aggregated format
            embedding = item['values']
            video_id = item['id']
            video_metadata = item.get('metadata', {})
        else:
            # Different format - skip
            continue
        
        all_ids.append(video_id)
        all_embeddings.append(embedding)
        all_metadata.append(video_metadata)
    
    print(f"\n✅ Total embeddings loaded: {len(all_embeddings):,}")
    
    # Convert to numpy array
    embeddings_array = np.array(all_embeddings)
    print(f"📐 Embeddings shape: {embeddings_array.shape}")
    
    return embeddings_array, all_ids, all_metadata

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
    
    # Show top 20 clusters
    print("\n🔝 Top 20 largest clusters:")
    for i, size in enumerate(cluster_sizes[:20]):
        print(f"  Cluster {i+1}: {size:,} videos")
    
    return {
        'n_clusters': n_clusters,
        'n_noise': n_noise,
        'cluster_sizes': cluster_sizes,
        'unique_clusters': unique_clusters
    }

def save_results(cluster_labels, video_ids, clusterer, analysis_results, metadata_list):
    """Save clustering results"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # Save cluster assignments
    print("\n💾 Saving results...")
    
    assignments = []
    for video_id, cluster_id, metadata in zip(video_ids, cluster_labels, metadata_list):
        assignments.append({
            'video_id': video_id,
            'cluster_id': int(cluster_id),
            'title': metadata.get('title', ''),
            'channel_id': metadata.get('channel_id', ''),
            'channel_title': metadata.get('channel_title', '')
        })
    
    # Save assignments
    output_file = f'hdbscan_assignments_50k_{timestamp}.json'
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
    
    # Save cluster summary with sample videos
    summary_file = f'hdbscan_summary_50k_{timestamp}.json'
    cluster_summary = []
    
    for cluster_id in analysis_results['unique_clusters']:
        if cluster_id >= 0:
            cluster_videos = []
            for vid, cid, metadata in zip(video_ids, cluster_labels, metadata_list):
                if cid == cluster_id:
                    cluster_videos.append({
                        'id': vid,
                        'title': metadata.get('title', ''),
                        'channel_title': metadata.get('channel_title', '')
                    })
            
            cluster_summary.append({
                'cluster_id': int(cluster_id),
                'size': len(cluster_videos),
                'sample_videos': cluster_videos[:20]  # First 20 videos as sample
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
    print("🚀 HDBSCAN Clustering on Title Embeddings")
    print("=" * 50)
    
    try:
        # Load embeddings
        embeddings, video_ids, metadata_list = load_embeddings()
        
        # Run clustering with different parameters
        # Start with conservative parameters
        min_cluster_size = 30  # Minimum 30 videos per cluster
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
            analysis_results,
            metadata_list
        )
        
        print("\n✅ Clustering complete!")
        print(f"   Assignments: {assignments_file}")
        print(f"   Summary: {summary_file}")
        
        # Try another run with different parameters for more granularity
        if analysis_results['cluster_sizes'][0] > 2000:
            print("\n🔄 Running again with smaller min_cluster_size for more granularity...")
            
            min_cluster_size = 15  # Smaller clusters
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
                analysis_results2,
                metadata_list
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