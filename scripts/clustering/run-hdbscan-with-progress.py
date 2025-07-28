import json
import numpy as np
from datetime import datetime
import hdbscan
from sklearn.preprocessing import normalize
import os
import sys

def load_embeddings():
    """Load embeddings from the aggregated file"""
    print("🔍 Loading embeddings from aggregated file...")
    
    # Load from the exports directory
    embeddings_file = '/Users/brandoncullum/video-scripter/exports/title-embeddings-complete-aggregated.json'
    
    if not os.path.exists(embeddings_file):
        raise Exception(f"Embeddings file not found: {embeddings_file}")
    
    print(f"📂 Loading from: {embeddings_file}")
    print("   This may take a minute...")
    
    with open(embeddings_file, 'r') as f:
        data = json.load(f)
    
    print(f"📊 File contains {len(data['embeddings']):,} embeddings")
    
    all_embeddings = []
    all_ids = []
    all_metadata = []
    
    # Process embeddings with progress
    total = len(data['embeddings'])
    for i, item in enumerate(data['embeddings']):
        if i % 10000 == 0:
            print(f"   Processing: {i:,}/{total:,} ({i/total*100:.1f}%)")
        
        if 'values' in item:  # Aggregated format
            embedding = item['values']
            video_id = item['id']
            video_metadata = item.get('metadata', {})
        else:
            continue
        
        all_ids.append(video_id)
        all_embeddings.append(embedding)
        all_metadata.append(video_metadata)
    
    print(f"\n✅ Total embeddings loaded: {len(all_embeddings):,}")
    
    # Convert to numpy array
    print("   Converting to numpy array...")
    embeddings_array = np.array(all_embeddings)
    print(f"📐 Embeddings shape: {embeddings_array.shape}")
    
    return embeddings_array, all_ids, all_metadata

def run_hdbscan_clustering(embeddings, min_cluster_size=30, min_samples=10):
    """Run HDBSCAN clustering on embeddings"""
    print("\n🔬 Running HDBSCAN clustering...")
    print(f"  Parameters: min_cluster_size={min_cluster_size}, min_samples={min_samples}")
    print(f"  Dataset size: {embeddings.shape[0]:,} embeddings of {embeddings.shape[1]} dimensions")
    
    # Normalize embeddings
    print("\n  Step 1/3: Normalizing embeddings...")
    normalized_embeddings = normalize(embeddings, norm='l2')
    print("  ✓ Normalization complete")
    
    # Initialize HDBSCAN with verbose output
    print("\n  Step 2/3: Initializing HDBSCAN...")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True,
        core_dist_n_jobs=-1  # Use all CPU cores
    )
    print("  ✓ HDBSCAN initialized")
    
    # Fit the model
    print("\n  Step 3/3: Fitting HDBSCAN model...")
    print("  ⏱️  This will take 10-30 minutes for 50K embeddings")
    print("  💡 Tip: The process will appear frozen but it's working!")
    print("  🖥️  Check your CPU usage - it should be high")
    print("\n  Starting clustering now...")
    
    start_time = datetime.now()
    cluster_labels = clusterer.fit_predict(normalized_embeddings)
    end_time = datetime.now()
    
    duration = (end_time - start_time).total_seconds()
    print(f"\n  ✓ Clustering completed in {duration:.1f} seconds ({duration/60:.1f} minutes)")
    
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
            cluster_sizes.append((cluster_id, size))
    
    # Sort by size
    cluster_sizes.sort(key=lambda x: x[1], reverse=True)
    
    sizes_only = [s[1] for s in cluster_sizes]
    
    print("\n📈 Cluster size distribution:")
    print(f"  Largest cluster: {sizes_only[0]:,} videos")
    print(f"  Smallest cluster: {sizes_only[-1]:,} videos")
    print(f"  Median cluster size: {np.median(sizes_only):.0f} videos")
    print(f"  Mean cluster size: {np.mean(sizes_only):.1f} videos")
    
    # Show top 20 clusters
    print("\n🔝 Top 20 largest clusters:")
    for i, (cluster_id, size) in enumerate(cluster_sizes[:20]):
        print(f"  Rank {i+1}: Cluster {cluster_id} - {size:,} videos")
    
    return {
        'n_clusters': n_clusters,
        'n_noise': n_noise,
        'cluster_sizes': cluster_sizes,
        'unique_clusters': unique_clusters
    }

def save_results(cluster_labels, video_ids, clusterer, analysis_results, metadata_list):
    """Save clustering results"""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    print("\n💾 Saving results...")
    
    # Prepare assignments
    print("   Preparing cluster assignments...")
    assignments = []
    for i, (video_id, cluster_id, metadata) in enumerate(zip(video_ids, cluster_labels, metadata_list)):
        if i % 10000 == 0:
            print(f"   Progress: {i:,}/{len(video_ids):,}")
        
        assignments.append({
            'video_id': video_id,
            'cluster_id': int(cluster_id),
            'title': metadata.get('title', ''),
            'channel_id': metadata.get('channel_id', ''),
            'channel_title': metadata.get('channel_title', '')
        })
    
    # Save assignments
    output_file = f'hdbscan_assignments_50k_{timestamp}.json'
    print(f"\n   Saving assignments to: {output_file}")
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
    
    print(f"  ✓ Saved cluster assignments")
    
    # Save cluster summary with sample videos
    summary_file = f'hdbscan_summary_50k_{timestamp}.json'
    print(f"\n   Creating cluster summary...")
    cluster_summary = []
    
    for cluster_id, size in analysis_results['cluster_sizes']:
        if cluster_id >= 0:
            cluster_videos = []
            for vid, cid, metadata in zip(video_ids, cluster_labels, metadata_list):
                if cid == cluster_id:
                    cluster_videos.append({
                        'id': vid,
                        'title': metadata.get('title', ''),
                        'channel_title': metadata.get('channel_title', '')
                    })
                    if len(cluster_videos) >= 20:  # Only need first 20
                        break
            
            cluster_summary.append({
                'cluster_id': int(cluster_id),
                'size': size,
                'sample_videos': cluster_videos
            })
    
    print(f"   Saving summary to: {summary_file}")
    with open(summary_file, 'w') as f:
        json.dump({
            'metadata': {
                'timestamp': datetime.now().isoformat(),
                'n_clusters': analysis_results['n_clusters'],
                'total_videos': len(video_ids)
            },
            'clusters': cluster_summary
        }, f, indent=2)
    
    print(f"  ✓ Saved cluster summary")
    
    return output_file, summary_file

def main():
    print("🚀 HDBSCAN Clustering on Title Embeddings")
    print("=" * 50)
    print("⚠️  This script will take 10-30 minutes to complete")
    print("💡 Don't worry if it appears frozen - check your CPU usage")
    print("=" * 50)
    
    try:
        # Load embeddings
        embeddings, video_ids, metadata_list = load_embeddings()
        
        # Run clustering
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
        print("\n🎉 Success! You can now analyze the clusters.")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Process interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()