#!/usr/bin/env python3
"""
Multi-Level BERTopic Analysis for YouTube Video Titles
Analyzes video titles at 3 different granularity levels:
- Level 1: Broad domains (8-12 clusters)
- Level 2: Niches (50-100 clusters) 
- Level 3: Micro-topics (200-500 clusters)
"""

import pandas as pd
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from umap import UMAP
from hdbscan import HDBSCAN
import json
import os
from datetime import datetime
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MultiLevelBERTopicAnalyzer:
    def __init__(self, data_file_path):
        self.data_file_path = data_file_path
        self.df = None
        self.embeddings = None
        self.titles = None
        self.results = {}
        
    def load_data(self):
        """Load and prepare data from JSON export"""
        logger.info(f"Loading data from {self.data_file_path}")
        
        with open(self.data_file_path, 'r') as f:
            data = json.load(f)
        
        # Extract videos data
        videos = data['videos']
        logger.info(f"Loaded {len(videos)} videos")
        
        # Convert to DataFrame
        self.df = pd.DataFrame(videos)
        
        # Use cleaned_title if available, otherwise fall back to title
        if 'cleaned_title' in self.df.columns:
            self.titles = self.df['cleaned_title'].tolist()
            logger.info("Using cleaned titles for analysis")
        else:
            self.titles = self.df['title'].tolist()
            logger.info("Using original titles for analysis")
        
        # Note: We'll need to get embeddings from Pinecone or generate them
        # For now, we'll use the titles directly and let BERTopic generate embeddings
        logger.info("Data loaded successfully")
        
    def create_bertopic_model(self, n_clusters_range, level_name):
        """Create BERTopic model with specified cluster range"""
        logger.info(f"Creating BERTopic model for {level_name} (target clusters: {n_clusters_range})")
        
        # Configure UMAP for different granularities
        if "broad" in level_name.lower():
            # Level 1: Broad domains - more aggressive dimensionality reduction
            umap_model = UMAP(n_components=5, n_neighbors=50, min_dist=0.1, random_state=42)
            hdbscan_model = HDBSCAN(min_cluster_size=200, metric='euclidean', cluster_selection_method='eom')
        elif "niche" in level_name.lower():
            # Level 2: Niches - moderate granularity
            umap_model = UMAP(n_components=10, n_neighbors=30, min_dist=0.05, random_state=42)
            hdbscan_model = HDBSCAN(min_cluster_size=50, metric='euclidean', cluster_selection_method='eom')
        else:
            # Level 3: Micro-topics - fine granularity
            umap_model = UMAP(n_components=15, n_neighbors=15, min_dist=0.01, random_state=42)
            hdbscan_model = HDBSCAN(min_cluster_size=20, metric='euclidean', cluster_selection_method='eom')
        
        # Custom vectorizer to focus on meaningful words
        vectorizer_model = CountVectorizer(
            ngram_range=(1, 2),
            stop_words="english",
            min_df=2,
            max_features=5000
        )
        
        # Create BERTopic model
        topic_model = BERTopic(
            umap_model=umap_model,
            hdbscan_model=hdbscan_model,
            vectorizer_model=vectorizer_model,
            verbose=True
        )
        
        return topic_model
    
    def run_analysis_level(self, level_config):
        """Run BERTopic analysis for a specific level"""
        level_name = level_config['name']
        target_range = level_config['target_clusters']
        
        logger.info(f"🔄 Starting {level_name} analysis (targeting {target_range} clusters)")
        
        # Create model
        topic_model = self.create_bertopic_model(target_range, level_name)
        
        # Fit the model
        logger.info("Fitting BERTopic model...")
        topics, probs = topic_model.fit_transform(self.titles)
        
        # Get topic info
        topic_info = topic_model.get_topic_info()
        actual_clusters = len(topic_info) - 1  # Subtract 1 for outlier topic (-1)
        
        logger.info(f"✅ {level_name} complete: {actual_clusters} clusters discovered")
        
        # Create results for this level
        level_results = {
            'level_name': level_name,
            'target_clusters': target_range,
            'actual_clusters': actual_clusters,
            'topic_info': topic_info.to_dict('records'),
            'topics': topics if isinstance(topics, list) else topics.tolist(),
            'probabilities': probs.tolist() if probs is not None else None,
            'top_words_per_topic': {}
        }
        
        # Get top words for each topic
        for topic_id in range(actual_clusters):
            if topic_id in topic_model.topic_representations_:
                words = [word for word, score in topic_model.topic_representations_[topic_id]]
                level_results['top_words_per_topic'][topic_id] = words[:10]
        
        # Add video assignments
        self.df[f'{level_name.lower().replace(" ", "_")}_topic'] = topics
        if probs is not None:
            self.df[f'{level_name.lower().replace(" ", "_")}_probability'] = probs.max(axis=1) if len(probs.shape) > 1 else probs
        
        return level_results
    
    def analyze_performance_by_topic(self, level_results):
        """Analyze performance patterns within each topic"""
        level_name = level_results['level_name']
        topic_col = f'{level_name.lower().replace(" ", "_")}_topic'
        
        performance_analysis = {}
        
        for topic_id in range(level_results['actual_clusters']):
            topic_videos = self.df[self.df[topic_col] == topic_id]
            
            if len(topic_videos) > 0:
                # Calculate performance metrics
                avg_views = topic_videos['view_count'].mean()
                median_views = topic_videos['view_count'].median()
                avg_performance_ratio = topic_videos['performance_ratio'].mean() if 'performance_ratio' in topic_videos.columns else None
                
                # Get top performing videos in this topic
                top_videos = topic_videos.nlargest(5, 'view_count')[['title', 'view_count', 'channel_name']].to_dict('records')
                
                performance_analysis[topic_id] = {
                    'video_count': len(topic_videos),
                    'avg_views': avg_views,
                    'median_views': median_views,
                    'avg_performance_ratio': avg_performance_ratio,
                    'top_videos': top_videos,
                    'top_words': level_results['top_words_per_topic'].get(topic_id, [])
                }
        
        level_results['performance_analysis'] = performance_analysis
        return level_results
    
    def run_complete_analysis(self):
        """Run complete multi-level analysis"""
        logger.info("🚀 Starting Multi-Level BERTopic Analysis")
        
        # Load data
        self.load_data()
        
        # Define analysis levels
        levels = [
            {'name': 'Level 1 - Broad Domains', 'target_clusters': '8-12'},
            {'name': 'Level 2 - Niches', 'target_clusters': '50-100'},
            {'name': 'Level 3 - Micro Topics', 'target_clusters': '200-500'}
        ]
        
        # Run analysis for each level
        for level_config in levels:
            level_results = self.run_analysis_level(level_config)
            level_results = self.analyze_performance_by_topic(level_results)
            self.results[level_config['name']] = level_results
        
        # Save results
        self.save_results()
        
        # Print summary
        self.print_summary()
    
    def save_results(self):
        """Save all results to files"""
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        
        # Create exports directory if it doesn't exist
        exports_dir = '/Users/brandoncullum/video-scripter/exports'
        os.makedirs(exports_dir, exist_ok=True)
        
        # Save complete results as JSON
        results_file = f"{exports_dir}/multi-level-bertopic-results-{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2, default=str)
        
        logger.info(f"💾 Complete results saved to: {results_file}")
        
        # Save enhanced DataFrame with topic assignments
        csv_file = f"{exports_dir}/videos-with-topic-assignments-{timestamp}.csv"
        self.df.to_csv(csv_file, index=False)
        logger.info(f"📊 Enhanced dataset saved to: {csv_file}")
        
        # Save summary report
        summary_file = f"{exports_dir}/bertopic-summary-{timestamp}.txt"
        with open(summary_file, 'w') as f:
            f.write("Multi-Level BERTopic Analysis Summary\n")
            f.write("=" * 50 + "\n\n")
            
            for level_name, results in self.results.items():
                f.write(f"{level_name}\n")
                f.write("-" * 30 + "\n")
                f.write(f"Target clusters: {results['target_clusters']}\n")
                f.write(f"Actual clusters: {results['actual_clusters']}\n")
                
                # Top 10 topics by size
                topic_info = pd.DataFrame(results['topic_info'])
                if not topic_info.empty:
                    top_topics = topic_info.head(10)
                    f.write(f"\nTop 10 topics by size:\n")
                    for _, topic in top_topics.iterrows():
                        topic_id = topic['Topic']
                        if topic_id != -1:  # Skip outlier topic
                            words = results['top_words_per_topic'].get(topic_id, [])
                            f.write(f"  Topic {topic_id}: {', '.join(words[:5])} ({topic['Count']} videos)\n")
                f.write("\n\n")
        
        logger.info(f"📋 Summary report saved to: {summary_file}")
    
    def print_summary(self):
        """Print analysis summary to console"""
        logger.info("\n" + "=" * 60)
        logger.info("🎉 MULTI-LEVEL BERTOPIC ANALYSIS COMPLETE")
        logger.info("=" * 60)
        
        for level_name, results in self.results.items():
            logger.info(f"\n{level_name}:")
            logger.info(f"  Target: {results['target_clusters']} clusters")
            logger.info(f"  Actual: {results['actual_clusters']} clusters discovered")
            
            # Show top 3 topics
            topic_info = pd.DataFrame(results['topic_info'])
            if not topic_info.empty and len(topic_info) > 1:
                top_3 = topic_info[topic_info['Topic'] != -1].head(3)
                logger.info("  Top 3 topics:")
                for _, topic in top_3.iterrows():
                    topic_id = topic['Topic']
                    words = results['top_words_per_topic'].get(topic_id, [])
                    logger.info(f"    Topic {topic_id}: {', '.join(words[:3])} ({topic['Count']} videos)")

def main():
    import sys
    
    # Check for custom input file argument
    if len(sys.argv) > 2 and sys.argv[1] == '--input':
        data_file = sys.argv[2]
    else:
        # Default to minimal cleaned data if available, otherwise original
        minimal_cleaned_file = '/Users/brandoncullum/video-scripter/exports/minimal-cleaned-titles-for-bertopic-2025-07-10_11-50-48.json'
        original_file = '/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json'
        
        if os.path.exists(minimal_cleaned_file):
            data_file = minimal_cleaned_file
            logger.info("Using minimal cleaned dataset for analysis")
        else:
            data_file = original_file
            logger.info("Using original dataset for analysis")
    
    if not os.path.exists(data_file):
        logger.error(f"Data file not found: {data_file}")
        logger.error("Please ensure the file exists before running analysis")
        return
    
    logger.info(f"Analyzing: {data_file}")
    
    # Create analyzer and run
    analyzer = MultiLevelBERTopicAnalyzer(data_file)
    analyzer.run_complete_analysis()
    
    logger.info("\n🎯 Analysis complete! Check the exports/ directory for results.")
    logger.info("Next step: Use Claude Code to analyze the topic patterns and naming.")

if __name__ == "__main__":
    main()