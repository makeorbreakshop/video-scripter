#!/usr/bin/env python3
"""
Clustering Analysis for Video Embeddings
Run this after exporting embeddings from Pinecone

This script will:
1. Load your exported embeddings
2. Perform clustering analysis
3. Show you natural groupings in your content
4. Help you understand what categories emerge
"""

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import silhouette_score
import json
import os
from datetime import datetime

class VideoEmbeddingAnalyzer:
    def __init__(self, csv_path):
        """Initialize with path to exported CSV file"""
        self.csv_path = csv_path
        self.df = None
        self.embeddings = None
        self.clusters = None
        
    def load_data(self):
        """Load and prepare the embedding data"""
        print("📊 Loading embedding data...")
        
        # Load the CSV line by line to handle problematic quotes
        import csv
        rows = []
        with open(self.csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, quotechar='"', doublequote=True)
            headers = next(reader)
            for row in reader:
                if len(row) == 6:  # Expected number of columns
                    rows.append(row)
                else:
                    print(f"   Skipping malformed row with {len(row)} columns")
        
        # Convert to DataFrame
        self.df = pd.DataFrame(rows, columns=headers)
        print(f"   Loaded {len(self.df)} videos")
        
        # Convert data types
        print("🔄 Converting data types...")
        self.df['view_count'] = pd.to_numeric(self.df['view_count'], errors='coerce')
        self.df['performance_ratio'] = pd.to_numeric(self.df['performance_ratio'], errors='coerce')
        
        # Convert embedding strings back to numpy arrays
        print("🔄 Converting embeddings to numpy arrays...")
        self.df['embedding'] = self.df['embedding'].str.split('|').apply(
            lambda x: np.array([float(i) for i in x])
        )
        
        # Create embedding matrix
        self.embeddings = np.vstack(self.df['embedding'].values)
        print(f"   Embedding matrix shape: {self.embeddings.shape}")
        
        # Basic stats
        print("\n📈 Basic Statistics:")
        print(f"   Average views: {self.df['view_count'].mean():,.0f}")
        print(f"   Average performance ratio: {self.df['performance_ratio'].mean():.2f}")
        print(f"   Unique channels: {self.df['channel_name'].nunique()}")
        
        return self.df
    
    def find_optimal_clusters(self, max_clusters=15):
        """Find optimal number of clusters using elbow method"""
        print(f"\n🔍 Finding optimal number of clusters (testing up to {max_clusters})...")
        
        inertias = []
        silhouette_scores = []
        cluster_range = range(2, max_clusters + 1)
        
        for n_clusters in cluster_range:
            print(f"   Testing {n_clusters} clusters...")
            
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
            cluster_labels = kmeans.fit_predict(self.embeddings)
            
            inertias.append(kmeans.inertia_)
            silhouette_scores.append(silhouette_score(self.embeddings, cluster_labels))
        
        # Plot results
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 5))
        
        # Elbow plot
        ax1.plot(cluster_range, inertias, 'bo-')
        ax1.set_xlabel('Number of Clusters')
        ax1.set_ylabel('Inertia')
        ax1.set_title('Elbow Method for Optimal Clusters')
        ax1.grid(True)
        
        # Silhouette plot
        ax2.plot(cluster_range, silhouette_scores, 'ro-')
        ax2.set_xlabel('Number of Clusters')
        ax2.set_ylabel('Silhouette Score')
        ax2.set_title('Silhouette Analysis')
        ax2.grid(True)
        
        plt.tight_layout()
        plt.savefig('cluster_analysis.png', dpi=300, bbox_inches='tight')
        plt.show()
        
        # Find best number of clusters
        best_silhouette_idx = np.argmax(silhouette_scores)
        best_n_clusters = cluster_range[best_silhouette_idx]
        
        print(f"✅ Recommended number of clusters: {best_n_clusters}")
        print(f"   Silhouette score: {silhouette_scores[best_silhouette_idx]:.3f}")
        
        return best_n_clusters
    
    def perform_clustering(self, n_clusters=None):
        """Perform K-means clustering"""
        if n_clusters is None:
            n_clusters = self.find_optimal_clusters()
        
        print(f"\n🎯 Performing clustering with {n_clusters} clusters...")
        
        # Perform clustering
        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        self.clusters = kmeans.fit_predict(self.embeddings)
        
        # Add cluster labels to dataframe
        self.df['cluster'] = self.clusters
        
        # Calculate cluster statistics
        cluster_stats = []
        for i in range(n_clusters):
            cluster_videos = self.df[self.df['cluster'] == i]
            stats = {
                'cluster_id': i,
                'video_count': len(cluster_videos),
                'avg_views': cluster_videos['view_count'].mean(),
                'avg_performance': cluster_videos['performance_ratio'].mean(),
                'top_channels': cluster_videos['channel_name'].value_counts().head(3).to_dict(),
                'sample_titles': cluster_videos['title'].head(5).tolist()
            }
            cluster_stats.append(stats)
        
        return cluster_stats
    
    def visualize_clusters(self):
        """Create 2D visualization of clusters using PCA"""
        print("\n📊 Creating cluster visualization...")
        
        # Reduce dimensions for visualization
        pca = PCA(n_components=2, random_state=42)
        embeddings_2d = pca.fit_transform(self.embeddings)
        
        # Create scatter plot
        plt.figure(figsize=(12, 8))
        scatter = plt.scatter(embeddings_2d[:, 0], embeddings_2d[:, 1], 
                            c=self.clusters, cmap='tab10', alpha=0.6)
        plt.colorbar(scatter)
        plt.xlabel(f'PC1 ({pca.explained_variance_ratio_[0]:.1%} variance)')
        plt.ylabel(f'PC2 ({pca.explained_variance_ratio_[1]:.1%} variance)')
        plt.title('Video Clusters in 2D Space')
        plt.grid(True, alpha=0.3)
        
        # Add cluster centers
        cluster_centers_2d = pca.transform(
            KMeans(n_clusters=len(np.unique(self.clusters)), random_state=42)
            .fit(self.embeddings).cluster_centers_
        )
        plt.scatter(cluster_centers_2d[:, 0], cluster_centers_2d[:, 1], 
                   c='red', marker='x', s=200, linewidths=3, label='Centroids')
        plt.legend()
        
        plt.tight_layout()
        plt.savefig('cluster_visualization.png', dpi=300, bbox_inches='tight')
        plt.show()
    
    def analyze_clusters(self, cluster_stats):
        """Analyze and display cluster characteristics"""
        print("\n🔍 Cluster Analysis Results:")
        print("=" * 60)
        
        for stats in cluster_stats:
            print(f"\n📂 Cluster {stats['cluster_id']} ({stats['video_count']} videos)")
            print(f"   Average views: {stats['avg_views']:,.0f}")
            print(f"   Average performance: {stats['avg_performance']:.2f}")
            
            print("   Top channels:")
            for channel, count in stats['top_channels'].items():
                print(f"     • {channel}: {count} videos")
            
            print("   Sample titles:")
            for title in stats['sample_titles']:
                print(f"     • {title}")
        
        # Performance analysis
        print("\n📈 Performance Analysis:")
        cluster_performance = self.df.groupby('cluster').agg({
            'performance_ratio': ['mean', 'std', 'count'],
            'view_count': 'mean'
        }).round(2)
        print(cluster_performance)
        
        return cluster_stats
    
    def save_results(self, cluster_stats):
        """Save clustering results to files"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Save cluster assignments
        output_file = f'cluster_results_{timestamp}.csv'
        self.df.to_csv(output_file, index=False)
        print(f"\n💾 Saved cluster assignments to: {output_file}")
        
        # Save cluster statistics
        stats_file = f'cluster_statistics_{timestamp}.json'
        with open(stats_file, 'w') as f:
            json.dump(cluster_stats, f, indent=2)
        print(f"💾 Saved cluster statistics to: {stats_file}")
        
        return output_file, stats_file
    
    def run_full_analysis(self, n_clusters=None):
        """Run complete clustering analysis"""
        # Load data
        self.load_data()
        
        # Find optimal clusters (if not specified)
        if n_clusters is None:
            n_clusters = self.find_optimal_clusters()
        
        # Perform clustering
        cluster_stats = self.perform_clustering(n_clusters)
        
        # Visualize results
        self.visualize_clusters()
        
        # Analyze clusters
        self.analyze_clusters(cluster_stats)
        
        # Save results
        self.save_results(cluster_stats)
        
        print("\n🎉 Analysis complete!")
        print("Next steps:")
        print("1. Review the cluster visualization")
        print("2. Look at the cluster statistics")
        print("3. Decide if you want to try different numbers of clusters")
        print("4. Use these insights to build your categorization system")

# Usage example
if __name__ == "__main__":
    # Use the actual exported file
    csv_path = "exports/title-embeddings-for-clustering-2025-07-08T18-18-10-540Z.csv"
    
    print("🚀 Video Embedding Clustering Analysis")
    print("=" * 50)
    
    # Check if file exists
    import glob
    csv_files = glob.glob(csv_path)
    if not csv_files:
        print("❌ No CSV files found!")
        print("   Please run the export script first:")
        print("   node scripts/export-pinecone-embeddings.js")
        exit(1)
    
    # Use the most recent file
    csv_file = sorted(csv_files)[-1]
    print(f"📁 Using file: {csv_file}")
    
    # Run analysis with specific number of clusters to speed up
    analyzer = VideoEmbeddingAnalyzer(csv_file)
    analyzer.run_full_analysis(n_clusters=12)