#!/usr/bin/env python3
"""
BERTopic Analysis for Granular Video Content Categorization
Uses existing OpenAI embeddings to discover specific content niches

This script will:
1. Load existing title embeddings and video data
2. Use BERTopic to discover granular topics (50+ vs 12 from K-means)
3. Create hierarchical topic structure
4. Generate topic keywords and descriptions
5. Build similarity search capabilities
"""

import pandas as pd
import numpy as np
from bertopic import BERTopic
from bertopic.representation import KeyBERTInspired
from bertopic.vectorizers import ClassTfidfTransformer
from bertopic.dimensionality import BaseDimensionalityReduction
from sklearn.cluster import HDBSCAN
from umap import UMAP
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime
import json
import csv
import os

class PrecomputedEmbeddings(BaseDimensionalityReduction):
    """Custom dimensionality reduction that uses pre-computed embeddings"""
    
    def __init__(self, embeddings):
        self.embeddings = embeddings
        
    def fit(self, X):
        return self
        
    def transform(self, X):
        return self.embeddings

class VideoTopicAnalyzer:
    def __init__(self, csv_path):
        """Initialize with path to exported CSV file"""
        self.csv_path = csv_path
        self.df = None
        self.embeddings = None
        self.topics = None
        self.topic_model = None
        self.topic_info = None
        
    def load_data(self):
        """Load and prepare the embedding data"""
        print("📊 Loading video data and embeddings...")
        
        # Load CSV with custom parser (same as K-means script)
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
        
        # Convert embedding strings to numpy arrays
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
        print(f"   Video titles for analysis: {len(self.df)}")
        
        return self.df
        
    def create_topic_model(self, min_topic_size=50, n_neighbors=15, n_components=5):
        """Create BERTopic model with custom parameters"""
        print(f"\n🧪 Creating BERTopic model...")
        print(f"   Min topic size: {min_topic_size}")
        print(f"   UMAP neighbors: {n_neighbors}")
        print(f"   UMAP components: {n_components}")
        
        # Use pre-computed embeddings instead of generating new ones
        embedding_model = PrecomputedEmbeddings(self.embeddings)
        
        # UMAP for dimensionality reduction
        umap_model = UMAP(
            n_neighbors=n_neighbors, 
            n_components=n_components, 
            min_dist=0.0, 
            metric='cosine',
            random_state=42
        )
        
        # HDBSCAN for clustering
        hdbscan_model = HDBSCAN(
            min_cluster_size=min_topic_size,
            metric='euclidean',
            cluster_selection_method='eom'
        )
        
        # KeyBERT for topic representation
        representation_model = KeyBERTInspired()
        
        # Create BERTopic model
        self.topic_model = BERTopic(
            embedding_model=embedding_model,
            umap_model=umap_model,
            hdbscan_model=hdbscan_model,
            representation_model=representation_model,
            verbose=True
        )
        
        return self.topic_model
        
    def fit_topics(self):
        """Fit the BERTopic model to discover topics"""
        print("\n🔍 Discovering topics with BERTopic...")
        
        # Get video titles for topic modeling
        documents = self.df['title'].tolist()
        
        # Fit the model
        self.topics, self.probabilities = self.topic_model.fit_transform(documents)
        
        # Get topic info
        self.topic_info = self.topic_model.get_topic_info()
        
        print(f"✅ Discovered {len(self.topic_info)} topics")
        print(f"   Topics with -1 (outliers): {sum(np.array(self.topics) == -1)} videos")
        print(f"   Videos successfully categorized: {sum(np.array(self.topics) != -1)} videos")
        
        return self.topics
        
    def analyze_topics(self):
        """Analyze discovered topics and their characteristics"""
        print("\n📊 Analyzing discovered topics...")
        
        # Add topic assignments to dataframe
        self.df['topic'] = self.topics
        
        # Calculate topic statistics
        topic_stats = []
        for topic_id in self.topic_info['Topic'].values:
            if topic_id == -1:  # Skip outliers
                continue
                
            topic_videos = self.df[self.df['topic'] == topic_id]
            
            # Get topic keywords
            topic_words = self.topic_model.get_topic(topic_id)
            top_keywords = [word for word, score in topic_words[:10]]
            
            stats = {
                'topic_id': topic_id,
                'video_count': len(topic_videos),
                'avg_views': topic_videos['view_count'].mean(),
                'avg_performance': topic_videos['performance_ratio'].mean(),
                'top_keywords': top_keywords,
                'sample_titles': topic_videos['title'].head(5).tolist(),
                'top_channels': topic_videos['channel_name'].value_counts().head(3).to_dict()
            }
            topic_stats.append(stats)
        
        # Sort by video count (descending)
        topic_stats.sort(key=lambda x: x['video_count'], reverse=True)
        
        return topic_stats
        
    def display_topics(self, topic_stats):
        """Display topic analysis results"""
        print("\n🎯 BERTopic Analysis Results:")
        print("=" * 80)
        
        for i, stats in enumerate(topic_stats[:20]):  # Show top 20 topics
            print(f"\n📂 Topic {stats['topic_id']} ({stats['video_count']} videos)")
            print(f"   Performance: {stats['avg_performance']:.3f}")
            print(f"   Avg Views: {stats['avg_views']:,.0f}")
            
            print("   🔑 Keywords:")
            print(f"      {', '.join(stats['top_keywords'])}")
            
            print("   📺 Sample Titles:")
            for title in stats['sample_titles']:
                print(f"      • {title}")
                
            if stats['top_channels']:
                print("   📊 Top Channels:")
                for channel, count in stats['top_channels'].items():
                    if channel:  # Skip empty channel names
                        print(f"      • {channel}: {count} videos")
        
        print(f"\n... and {len(topic_stats) - 20} more topics")
        
    def create_visualizations(self):
        """Create topic visualizations"""
        print("\n📈 Creating topic visualizations...")
        
        # Topic distribution
        fig1 = self.topic_model.visualize_topics()
        fig1.write_html("topic_distribution.html")
        print("   📊 Topic distribution saved to: topic_distribution.html")
        
        # Topic hierarchy
        hierarchical_topics = self.topic_model.hierarchical_topics(self.df['title'].tolist())
        fig2 = self.topic_model.visualize_hierarchy(hierarchical_topics=hierarchical_topics)
        fig2.write_html("topic_hierarchy.html")
        print("   🌳 Topic hierarchy saved to: topic_hierarchy.html")
        
        # Document clusters
        fig3 = self.topic_model.visualize_documents(self.df['title'].tolist())
        fig3.write_html("document_clusters.html")
        print("   📄 Document clusters saved to: document_clusters.html")
        
    def save_results(self, topic_stats):
        """Save analysis results to files"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Save topic assignments
        output_file = f'bertopic_results_{timestamp}.csv'
        self.df.to_csv(output_file, index=False)
        print(f"\n💾 Saved topic assignments to: {output_file}")
        
        # Save topic statistics
        stats_file = f'bertopic_topic_stats_{timestamp}.json'
        with open(stats_file, 'w') as f:
            json.dump(topic_stats, f, indent=2)
        print(f"💾 Saved topic statistics to: {stats_file}")
        
        # Save topic model
        model_file = f'bertopic_model_{timestamp}'
        self.topic_model.save(model_file)
        print(f"💾 Saved BERTopic model to: {model_file}")
        
        # Save topic info
        topic_info_file = f'bertopic_topic_info_{timestamp}.csv'
        self.topic_info.to_csv(topic_info_file, index=False)
        print(f"💾 Saved topic info to: {topic_info_file}")
        
        return output_file, stats_file, model_file
        
    def build_similarity_search(self):
        """Build similarity search capabilities"""
        print("\n🔍 Building similarity search system...")
        
        # Create topic-based similarity search
        topic_similarity = {}
        
        for topic_id in self.topic_info['Topic'].values:
            if topic_id == -1:  # Skip outliers
                continue
                
            topic_videos = self.df[self.df['topic'] == topic_id]
            
            # Calculate average performance for this topic
            avg_performance = topic_videos['performance_ratio'].mean()
            
            # Get top performing videos in this topic
            top_performers = topic_videos.nlargest(5, 'performance_ratio')
            
            topic_similarity[topic_id] = {
                'topic_keywords': [word for word, score in self.topic_model.get_topic(topic_id)[:5]],
                'avg_performance': avg_performance,
                'video_count': len(topic_videos),
                'top_performers': top_performers[['title', 'performance_ratio', 'view_count']].to_dict('records')
            }
        
        # Save similarity search data
        similarity_file = f'topic_similarity_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        with open(similarity_file, 'w') as f:
            json.dump(topic_similarity, f, indent=2, default=str)
        
        print(f"💾 Saved similarity search data to: {similarity_file}")
        
        return topic_similarity
        
    def find_similar_videos(self, video_title, top_k=10):
        """Find videos similar to a given title"""
        if self.topic_model is None:
            print("❌ Topic model not fitted yet. Run fit_topics() first.")
            return []
            
        # Get topic for the given video
        video_topic = self.topic_model.find_topics(video_title, top_k=1)[0][0]
        
        if video_topic == -1:
            print(f"⚠️  Video '{video_title}' classified as outlier")
            return []
            
        # Get similar videos from the same topic
        similar_videos = self.df[self.df['topic'] == video_topic]
        
        # Sort by performance ratio
        similar_videos = similar_videos.sort_values('performance_ratio', ascending=False)
        
        return similar_videos.head(top_k)[['title', 'performance_ratio', 'view_count', 'topic']]
        
    def run_full_analysis(self, min_topic_size=50):
        """Run complete BERTopic analysis"""
        print("🚀 Starting BERTopic Analysis for Granular Content Categorization")
        print("=" * 80)
        
        # Load data
        self.load_data()
        
        # Create and fit topic model
        self.create_topic_model(min_topic_size=min_topic_size)
        self.fit_topics()
        
        # Analyze topics
        topic_stats = self.analyze_topics()
        
        # Display results
        self.display_topics(topic_stats)
        
        # Create visualizations
        self.create_visualizations()
        
        # Build similarity search
        similarity_data = self.build_similarity_search()
        
        # Save results
        self.save_results(topic_stats)
        
        print("\n🎉 BERTopic Analysis Complete!")
        print("Next steps:")
        print("1. Review topic visualizations in the HTML files")
        print("2. Examine topic statistics and keywords")
        print("3. Test similarity search with specific videos")
        print("4. Build hierarchical taxonomy based on discovered topics")
        print("5. Integrate with content strategy pipeline")

# Usage example
if __name__ == "__main__":
    # Use the existing exported embeddings
    csv_path = "exports/title-embeddings-for-clustering-2025-07-08T18-18-10-540Z.csv"
    
    print("🚀 BERTopic Video Content Analysis")
    print("=" * 60)
    
    # Check if file exists
    if not os.path.exists(csv_path):
        print("❌ CSV file not found!")
        print("   Please ensure the embedding export file exists:")
        print(f"   {csv_path}")
        exit(1)
    
    print(f"📁 Using file: {csv_path}")
    
    # Run analysis
    analyzer = VideoTopicAnalyzer(csv_path)
    analyzer.run_full_analysis(min_topic_size=30)  # Lower min_topic_size for more granular topics
    
    # Example similarity search
    print("\n🔍 Example Similarity Search:")
    sample_title = "How to build a DIY workbench"
    similar = analyzer.find_similar_videos(sample_title, top_k=5)
    print(f"Videos similar to '{sample_title}':")
    print(similar)