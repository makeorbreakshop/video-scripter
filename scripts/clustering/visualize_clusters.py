#!/usr/bin/env python3
"""
Visualize HDBSCAN clustering results using dimensionality reduction
"""

import os
import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from datetime import datetime
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
from sklearn.manifold import TSNE
from sklearn.decomposition import PCA
import warnings
warnings.filterwarnings('ignore')

# Load environment variables
load_dotenv()

# Database connection
DB_URL = os.getenv('DATABASE_URL')
if not DB_URL:
    print("Error: DATABASE_URL not found in environment variables")
    sys.exit(1)

def load_clustering_results():
    """Load clustering results from database"""
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # Get the latest clustering version
    cur.execute("""
    SELECT DISTINCT clustering_version 
    FROM video_hdbscan_clusters 
    ORDER BY clustering_version DESC 
    LIMIT 1
    """)
    
    result = cur.fetchone()
    if not result:
        print("No clustering results found in database")
        sys.exit(1)
    
    version = result['clustering_version']
    print(f"Loading clustering results for version: {version}")
    
    # Load videos with clusters and embeddings
    query = """
    SELECT 
        v.id,
        v.title,
        v.channel_name,
        v.view_count,
        v.published_at,
        v.title_embedding::text as embedding_text,
        c.cluster_id,
        c.cluster_probability
    FROM videos v
    INNER JOIN video_hdbscan_clusters c ON v.id = c.video_id
    WHERE c.clustering_version = %s
    AND v.title_embedding IS NOT NULL
    """
    
    cur.execute(query, (version,))
    results = cur.fetchall()
    
    print(f"Loaded {len(results)} videos with cluster assignments")
    
    # Convert to DataFrame
    df = pd.DataFrame(results)
    
    # Parse embeddings
    embeddings = []
    for row in results:
        embedding_str = row['embedding_text'].strip('[]')
        embedding = np.array([float(x) for x in embedding_str.split(',')])
        embeddings.append(embedding)
    
    embeddings_array = np.array(embeddings)
    
    cur.close()
    conn.close()
    
    return df, embeddings_array, version

def reduce_dimensions(embeddings, method='tsne', n_components=2):
    """Reduce embedding dimensions for visualization"""
    print(f"\nReducing dimensions using {method.upper()}...")
    
    if method == 'pca':
        reducer = PCA(n_components=n_components, random_state=42)
    elif method == 'tsne':
        # First reduce with PCA for efficiency
        if embeddings.shape[1] > 50:
            pca = PCA(n_components=50, random_state=42)
            embeddings = pca.fit_transform(embeddings)
        
        reducer = TSNE(n_components=n_components, perplexity=30, 
                       n_iter=1000, random_state=42)
    else:
        raise ValueError(f"Unknown method: {method}")
    
    reduced = reducer.fit_transform(embeddings)
    return reduced

def create_visualizations(df, embeddings, reduced_2d, version):
    """Create and save cluster visualizations"""
    output_dir = '/Users/brandoncullum/video-scripter/outputs/clustering'
    os.makedirs(output_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # Set style
    plt.style.use('seaborn-v0_8-darkgrid')
    sns.set_palette("husl")
    
    # 1. Main cluster visualization
    plt.figure(figsize=(12, 8))
    
    # Get unique clusters and assign colors
    unique_clusters = sorted(df['cluster_id'].unique())
    n_clusters = len([c for c in unique_clusters if c != -1])
    
    # Create color map
    colors = plt.cm.tab20(np.linspace(0, 1, n_clusters))
    color_map = {cluster: colors[i] for i, cluster in enumerate(unique_clusters) if cluster != -1}
    color_map[-1] = (0.5, 0.5, 0.5, 0.3)  # Gray for noise
    
    # Plot each cluster
    for cluster_id in unique_clusters:
        mask = df['cluster_id'] == cluster_id
        cluster_points = reduced_2d[mask]
        
        if cluster_id == -1:
            label = 'Noise'
            alpha = 0.3
        else:
            cluster_size = mask.sum()
            label = f'Cluster {cluster_id} (n={cluster_size})'
            alpha = 0.6
        
        plt.scatter(cluster_points[:, 0], cluster_points[:, 1], 
                   c=[color_map[cluster_id]], label=label, alpha=alpha, s=20)
    
    plt.title(f'HDBSCAN Clustering of YouTube Video Titles\n{n_clusters} clusters found', 
              fontsize=16)
    plt.xlabel('Component 1')
    plt.ylabel('Component 2')
    plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left', ncol=2)
    plt.tight_layout()
    
    plot_file = os.path.join(output_dir, f'cluster_visualization_{timestamp}.png')
    plt.savefig(plot_file, dpi=300, bbox_inches='tight')
    plt.close()
    print(f"Saved cluster visualization to: {plot_file}")
    
    # 2. Cluster size distribution
    plt.figure(figsize=(10, 6))
    cluster_sizes = df[df['cluster_id'] != -1]['cluster_id'].value_counts().sort_index()
    
    plt.bar(cluster_sizes.index, cluster_sizes.values)
    plt.title('Cluster Size Distribution', fontsize=16)
    plt.xlabel('Cluster ID')
    plt.ylabel('Number of Videos')
    plt.xticks(rotation=45)
    
    for i, (cluster_id, size) in enumerate(cluster_sizes.items()):
        plt.text(cluster_id, size + 10, str(size), ha='center')
    
    plt.tight_layout()
    size_plot = os.path.join(output_dir, f'cluster_sizes_{timestamp}.png')
    plt.savefig(size_plot, dpi=300)
    plt.close()
    print(f"Saved cluster size plot to: {size_plot}")
    
    # 3. Performance by cluster (views)
    plt.figure(figsize=(12, 6))
    
    # Calculate average views per cluster
    cluster_performance = df[df['cluster_id'] != -1].groupby('cluster_id')['view_count'].agg(['mean', 'median'])
    
    x = np.arange(len(cluster_performance))
    width = 0.35
    
    plt.bar(x - width/2, cluster_performance['mean'], width, label='Mean Views', alpha=0.8)
    plt.bar(x + width/2, cluster_performance['median'], width, label='Median Views', alpha=0.8)
    
    plt.title('Video Performance by Cluster', fontsize=16)
    plt.xlabel('Cluster ID')
    plt.ylabel('View Count')
    plt.xticks(x, cluster_performance.index, rotation=45)
    plt.legend()
    plt.yscale('log')  # Log scale for better visibility
    
    plt.tight_layout()
    perf_plot = os.path.join(output_dir, f'cluster_performance_{timestamp}.png')
    plt.savefig(perf_plot, dpi=300)
    plt.close()
    print(f"Saved performance plot to: {perf_plot}")
    
    # 4. Interactive HTML visualization (using plotly if available)
    try:
        import plotly.graph_objects as go
        import plotly.express as px
        
        # Create interactive scatter plot
        fig = go.Figure()
        
        for cluster_id in unique_clusters:
            mask = df['cluster_id'] == cluster_id
            cluster_df = df[mask]
            cluster_points = reduced_2d[mask]
            
            # Create hover text
            hover_text = []
            for _, row in cluster_df.iterrows():
                text = f"Title: {row['title']}<br>"
                text += f"Channel: {row['channel_name']}<br>"
                text += f"Views: {row['view_count']:,}<br>"
                text += f"Cluster: {cluster_id}"
                hover_text.append(text)
            
            fig.add_trace(go.Scatter(
                x=cluster_points[:, 0],
                y=cluster_points[:, 1],
                mode='markers',
                name=f'Cluster {cluster_id}' if cluster_id != -1 else 'Noise',
                text=hover_text,
                hoverinfo='text',
                marker=dict(
                    size=6,
                    opacity=0.7 if cluster_id != -1 else 0.3
                )
            ))
        
        fig.update_layout(
            title=f'Interactive HDBSCAN Clustering Results<br>{n_clusters} clusters found',
            xaxis_title='Component 1',
            yaxis_title='Component 2',
            hovermode='closest',
            width=1200,
            height=800
        )
        
        html_file = os.path.join(output_dir, f'cluster_interactive_{timestamp}.html')
        fig.write_html(html_file)
        print(f"Saved interactive plot to: {html_file}")
        
    except ImportError:
        print("Plotly not installed, skipping interactive visualization")
    
    return plot_file, size_plot, perf_plot

def main():
    """Main execution function"""
    print("HDBSCAN Cluster Visualization")
    print("=" * 50)
    
    # Load results
    df, embeddings, version = load_clustering_results()
    
    # Reduce dimensions
    reduced_2d = reduce_dimensions(embeddings, method='tsne')
    
    # Create visualizations
    create_visualizations(df, embeddings, reduced_2d, version)
    
    # Print summary statistics
    print("\nClustering Summary:")
    print(f"Total videos: {len(df)}")
    print(f"Clusters: {len(df[df['cluster_id'] != -1]['cluster_id'].unique())}")
    print(f"Noise points: {sum(df['cluster_id'] == -1)} ({sum(df['cluster_id'] == -1)/len(df)*100:.1f}%)")
    
    print("\nVisualization complete!")

if __name__ == "__main__":
    main()