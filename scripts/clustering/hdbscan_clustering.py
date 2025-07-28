#!/usr/bin/env python3
"""
HDBSCAN Clustering for YouTube Video Titles
Discovers natural groupings in video titles using their embeddings
"""

import os
import sys
import json
import numpy as np
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
import hdbscan
from sklearn.metrics import silhouette_score, calinski_harabasz_score
from sklearn.preprocessing import StandardScaler
import warnings
warnings.filterwarnings('ignore')

# Load environment variables
load_dotenv()

# Database connection
DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    print("Error: DATABASE_URL not found in environment variables")
    sys.exit(1)

def connect_db():
    """Create database connection"""
    return psycopg2.connect(DB_URL)

def extract_embeddings():
    """Extract title embeddings from the database"""
    print("Extracting title embeddings from database...")
    
    conn = connect_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Query to get videos with title embeddings
    query = """
    SELECT 
        id,
        title,
        channel_id,
        channel_name,
        view_count,
        published_at,
        title_embedding::text as embedding_text,
        topic_level_1,
        topic_level_2,
        topic_level_3,
        format_type
    FROM videos
    WHERE title_embedding IS NOT NULL
    ORDER BY published_at DESC
    """
    
    cur.execute(query)
    results = cur.fetchall()
    
    print(f"Found {len(results)} videos with title embeddings")
    
    # Convert to DataFrame
    df = pd.DataFrame(results)
    
    # Parse embeddings from text format
    print("Parsing embeddings...")
    embeddings = []
    for idx, row in df.iterrows():
        # PostgreSQL vector format: [0.1,0.2,0.3,...]
        embedding_str = row['embedding_text'].strip('[]')
        embedding = np.array([float(x) for x in embedding_str.split(',')])
        embeddings.append(embedding)
    
    embeddings_array = np.array(embeddings)
    print(f"Embeddings shape: {embeddings_array.shape}")
    
    cur.close()
    conn.close()
    
    return df, embeddings_array

def perform_clustering(embeddings, min_cluster_size=50, min_samples=5):
    """Perform HDBSCAN clustering on embeddings"""
    print(f"\nPerforming HDBSCAN clustering (min_cluster_size={min_cluster_size}, min_samples={min_samples})...")
    
    # Standardize embeddings (optional but can help)
    scaler = StandardScaler()
    embeddings_scaled = scaler.fit_transform(embeddings)
    
    # Initialize HDBSCAN
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric='euclidean',
        cluster_selection_method='eom',  # Excess of Mass
        prediction_data=True
    )
    
    # Fit the model
    cluster_labels = clusterer.fit_predict(embeddings_scaled)
    
    # Get probabilities
    probabilities = clusterer.probabilities_
    
    # Calculate statistics
    n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
    n_noise = list(cluster_labels).count(-1)
    
    print(f"Number of clusters: {n_clusters}")
    print(f"Number of noise points: {n_noise} ({n_noise/len(cluster_labels)*100:.1f}%)")
    
    # Calculate cluster quality metrics (excluding noise points)
    mask = cluster_labels != -1
    if sum(mask) > 0 and n_clusters > 1:
        silhouette = silhouette_score(embeddings_scaled[mask], cluster_labels[mask])
        calinski = calinski_harabasz_score(embeddings_scaled[mask], cluster_labels[mask])
        print(f"Silhouette score: {silhouette:.3f}")
        print(f"Calinski-Harabasz score: {calinski:.1f}")
    
    return clusterer, cluster_labels, probabilities

def analyze_clusters(df, cluster_labels, embeddings):
    """Analyze the discovered clusters"""
    print("\nAnalyzing clusters...")
    
    # Add cluster labels to dataframe
    df['hdbscan_cluster'] = cluster_labels
    
    cluster_stats = []
    
    # Analyze each cluster
    unique_clusters = sorted(set(cluster_labels))
    for cluster_id in unique_clusters:
        if cluster_id == -1:  # Skip noise
            continue
            
        cluster_mask = cluster_labels == cluster_id
        cluster_videos = df[cluster_mask]
        cluster_embeddings = embeddings[cluster_mask]
        
        # Calculate cluster statistics
        stats = {
            'cluster_id': int(cluster_id),
            'size': len(cluster_videos),
            'avg_views': int(cluster_videos['view_count'].mean()),
            'median_views': int(cluster_videos['view_count'].median()),
            'total_views': int(cluster_videos['view_count'].sum()),
            'unique_channels': cluster_videos['channel_id'].nunique(),
            'top_channels': cluster_videos['channel_name'].value_counts().head(5).to_dict(),
            'top_formats': cluster_videos['format_type'].value_counts().head(5).to_dict() if 'format_type' in cluster_videos else {},
            'date_range': {
                'earliest': cluster_videos['published_at'].min().isoformat() if pd.notna(cluster_videos['published_at'].min()) else None,
                'latest': cluster_videos['published_at'].max().isoformat() if pd.notna(cluster_videos['published_at'].max()) else None
            },
            'sample_titles': cluster_videos.nlargest(5, 'view_count')['title'].tolist(),
            'centroid': cluster_embeddings.mean(axis=0).tolist()  # Cluster centroid
        }
        
        # Calculate density (average distance to centroid)
        centroid = cluster_embeddings.mean(axis=0)
        distances = np.linalg.norm(cluster_embeddings - centroid, axis=1)
        stats['density'] = float(distances.mean())
        stats['density_std'] = float(distances.std())
        
        cluster_stats.append(stats)
        
        # Print cluster summary
        print(f"\nCluster {cluster_id}:")
        print(f"  Size: {stats['size']} videos")
        print(f"  Avg views: {stats['avg_views']:,}")
        print(f"  Channels: {stats['unique_channels']}")
        print(f"  Density: {stats['density']:.3f} ± {stats['density_std']:.3f}")
        print(f"  Top titles:")
        for title in stats['sample_titles'][:3]:
            print(f"    - {title[:80]}...")
    
    return df, cluster_stats

def save_results(df, cluster_stats, clusterer):
    """Save clustering results to database and files"""
    print("\nSaving results...")
    
    # Save cluster assignments to database
    conn = connect_db()
    cur = conn.cursor()
    
    # Create table for cluster assignments if it doesn't exist
    cur.execute("""
    CREATE TABLE IF NOT EXISTS video_hdbscan_clusters (
        video_id TEXT PRIMARY KEY REFERENCES videos(id),
        cluster_id INTEGER,
        cluster_probability FLOAT,
        clustering_version VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
    """)
    
    # Insert cluster assignments
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    version = f"hdbscan_v1_{timestamp}"
    
    print("Saving cluster assignments to database...")
    for idx, row in df.iterrows():
        cur.execute("""
        INSERT INTO video_hdbscan_clusters (video_id, cluster_id, cluster_probability, clustering_version)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (video_id) 
        DO UPDATE SET 
            cluster_id = EXCLUDED.cluster_id,
            cluster_probability = EXCLUDED.cluster_probability,
            clustering_version = EXCLUDED.clustering_version,
            created_at = NOW()
        """, (row['id'], int(row['hdbscan_cluster']), float(clusterer.probabilities_[idx]), version))
    
    # Create cluster metadata table
    cur.execute("""
    CREATE TABLE IF NOT EXISTS hdbscan_cluster_metadata (
        cluster_id INTEGER,
        clustering_version VARCHAR(50),
        size INTEGER,
        avg_views BIGINT,
        median_views BIGINT,
        unique_channels INTEGER,
        density FLOAT,
        density_std FLOAT,
        centroid VECTOR(512),
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (cluster_id, clustering_version)
    )
    """)
    
    # Insert cluster metadata
    print("Saving cluster metadata...")
    for stats in cluster_stats:
        # Prepare centroid as PostgreSQL vector format
        centroid_str = '[' + ','.join(map(str, stats['centroid'])) + ']'
        
        # Remove centroid from metadata to avoid duplication
        metadata = {k: v for k, v in stats.items() if k not in ['cluster_id', 'centroid']}
        
        cur.execute("""
        INSERT INTO hdbscan_cluster_metadata 
        (cluster_id, clustering_version, size, avg_views, median_views, unique_channels, 
         density, density_std, centroid, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s)
        """, (
            stats['cluster_id'], version, stats['size'], stats['avg_views'], 
            stats['median_views'], stats['unique_channels'], stats['density'],
            stats['density_std'], centroid_str, json.dumps(metadata)
        ))
    
    conn.commit()
    cur.close()
    conn.close()
    
    # Save results to files
    output_dir = '/Users/brandoncullum/video-scripter/outputs/clustering'
    os.makedirs(output_dir, exist_ok=True)
    
    # Save cluster assignments
    assignments_file = os.path.join(output_dir, f'hdbscan_assignments_{timestamp}.csv')
    df[['id', 'title', 'channel_name', 'view_count', 'hdbscan_cluster']].to_csv(
        assignments_file, index=False
    )
    print(f"Saved cluster assignments to: {assignments_file}")
    
    # Save cluster statistics
    stats_file = os.path.join(output_dir, f'hdbscan_stats_{timestamp}.json')
    with open(stats_file, 'w') as f:
        json.dump(cluster_stats, f, indent=2, default=str)
    print(f"Saved cluster statistics to: {stats_file}")
    
    # Save summary report
    report_file = os.path.join(output_dir, f'hdbscan_report_{timestamp}.txt')
    with open(report_file, 'w') as f:
        f.write(f"HDBSCAN Clustering Report\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n")
        f.write(f"Version: {version}\n\n")
        
        f.write(f"Total videos: {len(df)}\n")
        f.write(f"Number of clusters: {len(cluster_stats)}\n")
        f.write(f"Noise points: {sum(df['hdbscan_cluster'] == -1)}\n\n")
        
        f.write("Cluster Summary:\n")
        for stats in sorted(cluster_stats, key=lambda x: x['size'], reverse=True):
            f.write(f"\nCluster {stats['cluster_id']}:\n")
            f.write(f"  Size: {stats['size']} videos\n")
            f.write(f"  Avg views: {stats['avg_views']:,}\n")
            f.write(f"  Unique channels: {stats['unique_channels']}\n")
            f.write(f"  Density: {stats['density']:.3f} ± {stats['density_std']:.3f}\n")
            f.write(f"  Top channels: {', '.join(list(stats['top_channels'].keys())[:3])}\n")
            f.write(f"  Sample titles:\n")
            for title in stats['sample_titles'][:5]:
                f.write(f"    - {title}\n")
    
    print(f"Saved summary report to: {report_file}")

def main():
    """Main execution function"""
    print("YouTube Video Title HDBSCAN Clustering")
    print("=" * 50)
    
    # Extract embeddings
    df, embeddings = extract_embeddings()
    
    # Try different parameter settings
    param_settings = [
        {'min_cluster_size': 50, 'min_samples': 5},
        {'min_cluster_size': 100, 'min_samples': 10},
        {'min_cluster_size': 30, 'min_samples': 3}
    ]
    
    best_clusterer = None
    best_labels = None
    best_score = -1
    best_params = None
    
    print("\nTrying different parameter settings...")
    for params in param_settings:
        print(f"\nTesting with {params}")
        clusterer, labels, probs = perform_clustering(embeddings, **params)
        
        # Calculate score (using number of clusters vs noise ratio)
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        noise_ratio = list(labels).count(-1) / len(labels)
        
        # We want many clusters but low noise
        score = n_clusters * (1 - noise_ratio)
        
        if score > best_score and n_clusters > 10:  # Ensure we get meaningful clusters
            best_clusterer = clusterer
            best_labels = labels
            best_score = score
            best_params = params
    
    print(f"\nBest parameters: {best_params}")
    
    # Analyze best clustering
    df_with_clusters, cluster_stats = analyze_clusters(df, best_labels, embeddings)
    
    # Save results
    save_results(df_with_clusters, cluster_stats, best_clusterer)
    
    print("\nClustering complete!")

if __name__ == "__main__":
    main()