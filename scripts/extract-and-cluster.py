#!/usr/bin/env python3
"""
Extract all embeddings from Pinecone and perform clustering analysis
"""

import os
import json
import numpy as np
from pinecone import Pinecone
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler
import matplotlib.pyplot as plt
from collections import defaultdict

# Load environment variables from .env file
def load_env():
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key] = value

# Load environment variables
load_env()

# Initialize Pinecone
pc = Pinecone(api_key=os.environ.get('PINECONE_API_KEY'))
index_name = os.environ.get('PINECONE_INDEX_NAME', 'youtube-titles-prod')
index = pc.Index(index_name)

def extract_all_embeddings():
    """Extract all embeddings and metadata from Pinecone"""
    print("🔍 Extracting all embeddings from Pinecone...")
    
    # Query to get all vectors
    query_response = index.query(
        vector=[0] * 512,  # Dummy vector
        top_k=10000,  # Get all vectors
        include_metadata=True,
        include_values=True
    )
    
    embeddings = []
    metadata = []
    
    for match in query_response['matches']:
        embeddings.append(match['values'])
        metadata.append({
            'id': match['id'],
            'title': match['metadata'].get('title', ''),
            'channel_id': match['metadata'].get('channel_id', ''),
            'performance_ratio': match['metadata'].get('performance_ratio', 1.0),
            'view_count': match['metadata'].get('view_count', 0)
        })
    
    print(f"✅ Extracted {len(embeddings)} embeddings")
    return np.array(embeddings), metadata

def find_optimal_clusters(embeddings, max_k=100):
    """Find optimal number of clusters using elbow method and silhouette analysis"""
    print("📊 Finding optimal cluster count...")
    
    # Test different k values
    k_range = range(10, min(max_k, len(embeddings)//10), 10)
    inertias = []
    silhouette_scores = []
    
    for k in k_range:
        print(f"Testing k={k}...")
        kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = kmeans.fit_predict(embeddings)
        
        inertias.append(kmeans.inertia_)
        sil_score = silhouette_score(embeddings, labels)
        silhouette_scores.append(sil_score)
        
        print(f"  k={k}: inertia={kmeans.inertia_:.2f}, silhouette={sil_score:.3f}")
    
    # Find optimal k (highest silhouette score)
    optimal_k = k_range[np.argmax(silhouette_scores)]
    print(f"🎯 Optimal k: {optimal_k} (silhouette score: {max(silhouette_scores):.3f})")
    
    return optimal_k, list(zip(k_range, inertias, silhouette_scores))

def perform_clustering(embeddings, metadata, k):
    """Perform final clustering with optimal k"""
    print(f"🎯 Performing final clustering with k={k}...")
    
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings)
    
    # Group by cluster
    clusters = defaultdict(list)
    for i, label in enumerate(labels):
        clusters[label].append(metadata[i])
    
    return clusters, labels

def save_cluster_data(clusters, base_path="docs/clustering-investigation/raw-clusters/"):
    """Save cluster data to files"""
    print("💾 Saving cluster data...")
    
    os.makedirs(base_path, exist_ok=True)
    
    cluster_summary = []
    
    for cluster_id, videos in clusters.items():
        # Save titles to text file
        titles_file = f"{base_path}cluster-{cluster_id:02d}-titles.txt"
        with open(titles_file, 'w', encoding='utf-8') as f:
            for video in videos:
                f.write(f"{video['title']}\n")
        
        # Save full metadata to JSON
        metadata_file = f"{base_path}cluster-{cluster_id:02d}-metadata.json"
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(videos, f, indent=2)
        
        # Calculate cluster stats
        view_counts = [v['view_count'] for v in videos if v['view_count'] > 0]
        performance_ratios = [v['performance_ratio'] for v in videos if v['performance_ratio'] > 0]
        
        cluster_summary.append({
            'cluster_id': int(cluster_id),
            'video_count': len(videos),
            'avg_views': float(np.mean(view_counts)) if view_counts else 0,
            'avg_performance': float(np.mean(performance_ratios)) if performance_ratios else 0,
            'sample_titles': [v['title'] for v in videos[:5]]
        })
    
    # Save summary
    with open(f"{base_path}../cluster-summary.json", 'w', encoding='utf-8') as f:
        json.dump(cluster_summary, f, indent=2)
    
    print(f"✅ Saved {len(clusters)} clusters to {base_path}")
    return cluster_summary

def main():
    """Main execution"""
    print("🚀 Starting YouTube Title Clustering Analysis")
    
    # Extract embeddings
    embeddings, metadata = extract_all_embeddings()
    
    # Find optimal clusters
    optimal_k, k_analysis = find_optimal_clusters(embeddings)
    
    # Perform clustering
    clusters, labels = perform_clustering(embeddings, metadata, optimal_k)
    
    # Save results
    summary = save_cluster_data(clusters)
    
    # Print summary
    print("\n📋 Cluster Summary:")
    for cluster in sorted(summary, key=lambda x: x['video_count'], reverse=True)[:10]:
        print(f"Cluster {cluster['cluster_id']:2d}: {cluster['video_count']:4d} videos, "
              f"avg perf: {cluster['avg_performance']:.2f}")
        print(f"  Sample: {cluster['sample_titles'][0]}")
    
    print(f"\n🎉 Analysis complete! Found {len(clusters)} clusters from {len(metadata)} videos")
    print("📁 Data saved to docs/clustering-investigation/raw-clusters/")

if __name__ == "__main__":
    main()