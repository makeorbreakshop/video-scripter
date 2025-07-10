#!/usr/bin/env python3
"""
Improved Multi-Level BERTopic Analysis
Uses better clustering parameters and improved title cleaning
"""

import os
# Set environment variable to suppress tokenizer warnings
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

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

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ImprovedBERTopicAnalyzer:
    def __init__(self, data_file_path):
        self.data_file_path = data_file_path
        self.df = None
        self.titles = None
        self.results = {}
        
    def load_data(self):
        """Load and prepare data from JSON export"""
        logger.info(f"Loading data from {self.data_file_path}")
        
        with open(self.data_file_path, 'r') as f:
            data = json.load(f)
        
        videos = data['videos']
        logger.info(f"Loaded {len(videos)} videos")
        
        self.df = pd.DataFrame(videos)
        
        # Use improved_cleaned_title if available, fallback to cleaned_title, then title
        if 'improved_cleaned_title' in self.df.columns:
            self.titles = self.df['improved_cleaned_title'].tolist()
            logger.info("Using improved cleaned titles for analysis")
        elif 'cleaned_title' in self.df.columns:
            self.titles = self.df['cleaned_title'].tolist()
            logger.info("Using cleaned titles for analysis")
        else:
            self.titles = self.df['title'].tolist()
            logger.info("Using original titles for analysis")
            
        logger.info("Data loaded successfully")
        
    def create_bertopic_model(self, level_config):
        """Create BERTopic model with improved parameters"""
        level_name = level_config['name']
        logger.info(f"Creating improved BERTopic model for {level_name}")
        
        if "Level 1" in level_name:
            # Level 1: MUCH more aggressive clustering for broad domains
            umap_model = UMAP(
                n_components=3,      # Reduced from 5
                n_neighbors=100,     # Increased from 50  
                min_dist=0.3,        # Increased from 0.1
                random_state=42
            )
            hdbscan_model = HDBSCAN(
                min_cluster_size=500,    # Increased from 200
                min_samples=50,          # Added min_samples
                metric='euclidean',
                cluster_selection_method='eom'
            )
            
        elif "Level 2" in level_name:
            # Level 2: Moderate clustering for niches
            umap_model = UMAP(
                n_components=8,      # Reduced from 10
                n_neighbors=50,      # Increased from 30
                min_dist=0.1,        # Increased from 0.05
                random_state=42
            )
            hdbscan_model = HDBSCAN(
                min_cluster_size=100,    # Increased from 50
                min_samples=20,          # Added min_samples
                metric='euclidean',
                cluster_selection_method='eom'
            )
            
        else:
            # Level 3: Fine granularity for micro-topics
            umap_model = UMAP(
                n_components=15,
                n_neighbors=15,
                min_dist=0.01,
                random_state=42
            )
            hdbscan_model = HDBSCAN(
                min_cluster_size=30,     # Increased from 20
                min_samples=10,          # Added min_samples
                metric='euclidean',
                cluster_selection_method='eom'
            )
        
        # Improved vectorizer focused on content words
        vectorizer_model = CountVectorizer(
            ngram_range=(1, 2),
            stop_words="english",
            min_df=3,                    # Increased from 2
            max_features=3000,           # Reduced from 5000
            # Exclude very common maker terms that don't differentiate
            token_pattern=r'\b[a-zA-Z]{3,}\b'  # Minimum 3 characters
        )
        
        topic_model = BERTopic(
            umap_model=umap_model,
            hdbscan_model=hdbscan_model,
            vectorizer_model=vectorizer_model,
            verbose=True,
            calculate_probabilities=False  # Disable to avoid prediction data error
        )
        
        return topic_model
    
    def run_analysis_level(self, level_config):
        """Run improved BERTopic analysis for a specific level"""
        level_name = level_config['name']
        target_range = level_config['target_clusters']
        
        logger.info(f"🔄 Starting {level_name} analysis (targeting {target_range} clusters)")
        
        topic_model = self.create_bertopic_model(level_config)
        
        logger.info("Fitting improved BERTopic model...")
        topics, probs = topic_model.fit_transform(self.titles)
        
        topic_info = topic_model.get_topic_info()
        actual_clusters = len(topic_info) - 1  # Subtract outlier topic (-1)
        
        logger.info(f"✅ {level_name} complete: {actual_clusters} clusters discovered")
        
        # Show cluster distribution
        cluster_sizes = topic_info[topic_info['Topic'] != -1]['Count'].tolist()
        logger.info(f"   📊 Cluster size range: {min(cluster_sizes)} - {max(cluster_sizes)} videos")
        logger.info(f"   📊 Top 5 clusters: {sorted(cluster_sizes, reverse=True)[:5]}")
        
        level_results = {
            'level_name': level_name,
            'target_clusters': target_range,
            'actual_clusters': actual_clusters,
            'topic_info': topic_info.to_dict('records'),
            'topics': topics if isinstance(topics, list) else topics.tolist(),
            'probabilities': probs.tolist() if probs is not None else None,
            'top_words_per_topic': {},
            'cluster_distribution': {
                'min_size': int(min(cluster_sizes)),
                'max_size': int(max(cluster_sizes)),
                'avg_size': int(np.mean(cluster_sizes)),
                'median_size': int(np.median(cluster_sizes))
            }
        }
        
        # Get top words for each topic
        for topic_id in range(actual_clusters):
            if topic_id in topic_model.topic_representations_:
                words = [word for word, score in topic_model.topic_representations_[topic_id]]
                level_results['top_words_per_topic'][topic_id] = words[:10]
        
        # Add video assignments to dataframe
        col_name = f'{level_name.lower().replace(" ", "_").replace("-", "_")}_topic'
        self.df[col_name] = topics
        # Skip probabilities since we disabled them
        
        return level_results
    
    def run_complete_analysis(self):
        """Run complete improved multi-level analysis"""
        logger.info("🚀 Starting Improved Multi-Level BERTopic Analysis")
        
        self.load_data()
        
        # Updated target ranges based on learning
        levels = [
            {'name': 'Level 1 - Broad Domains', 'target_clusters': '8-15'},      # More realistic
            {'name': 'Level 2 - Niches', 'target_clusters': '50-120'},          # Adjusted  
            {'name': 'Level 3 - Micro Topics', 'target_clusters': '200-400'}    # More focused
        ]
        
        for level_config in levels:
            level_results = self.run_analysis_level(level_config)
            self.results[level_config['name']] = level_results
            
            # Log level summary
            logger.info(f"\n📋 {level_config['name']} Summary:")
            logger.info(f"   🎯 Target: {level_config['target_clusters']} clusters")
            logger.info(f"   ✅ Actual: {level_results['actual_clusters']} clusters")
            logger.info(f"   📊 Avg cluster size: {level_results['cluster_distribution']['avg_size']} videos")
        
        self.save_results()
        self.print_summary()
    
    def save_results(self):
        """Save improved results to files"""
        timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
        exports_dir = '/Users/brandoncullum/video-scripter/exports'
        os.makedirs(exports_dir, exist_ok=True)
        
        # Save complete results
        results_file = f"{exports_dir}/improved-bertopic-results-{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(self.results, f, indent=2, default=str)
        logger.info(f"💾 Improved results saved to: {results_file}")
        
        # Save enhanced dataset
        csv_file = f"{exports_dir}/improved-topic-assignments-{timestamp}.csv"
        self.df.to_csv(csv_file, index=False)
        logger.info(f"📊 Enhanced dataset saved to: {csv_file}")
        
        # Save improved summary
        summary_file = f"{exports_dir}/improved-bertopic-summary-{timestamp}.txt"
        with open(summary_file, 'w') as f:
            f.write("Improved Multi-Level BERTopic Analysis Summary\n")
            f.write("=" * 60 + "\n\n")
            
            for level_name, results in self.results.items():
                f.write(f"{level_name}\n")
                f.write("-" * 40 + "\n")
                f.write(f"Target clusters: {results['target_clusters']}\n")
                f.write(f"Actual clusters: {results['actual_clusters']}\n")
                f.write(f"Cluster size range: {results['cluster_distribution']['min_size']}-{results['cluster_distribution']['max_size']}\n")
                f.write(f"Average cluster size: {results['cluster_distribution']['avg_size']} videos\n\n")
                
                # Top topics
                topic_info = pd.DataFrame(results['topic_info'])
                if not topic_info.empty:
                    top_topics = topic_info[topic_info['Topic'] != -1].head(10)
                    f.write("Top 10 topics by size:\n")
                    for _, topic in top_topics.iterrows():
                        topic_id = topic['Topic']
                        words = results['top_words_per_topic'].get(topic_id, [])
                        f.write(f"  Topic {topic_id}: {', '.join(words[:5])} ({topic['Count']} videos)\n")
                f.write("\n\n")
        
        logger.info(f"📋 Improved summary saved to: {summary_file}")
    
    def print_summary(self):
        """Print improved analysis summary"""
        logger.info("\n" + "=" * 70)
        logger.info("🎉 IMPROVED MULTI-LEVEL BERTOPIC ANALYSIS COMPLETE")
        logger.info("=" * 70)
        
        for level_name, results in self.results.items():
            logger.info(f"\n{level_name}:")
            logger.info(f"  🎯 Target: {results['target_clusters']} clusters")
            logger.info(f"  ✅ Actual: {results['actual_clusters']} clusters")
            logger.info(f"  📊 Size range: {results['cluster_distribution']['min_size']}-{results['cluster_distribution']['max_size']} videos")
            
            # Show top 3 topics with better naming
            topic_info = pd.DataFrame(results['topic_info'])
            if not topic_info.empty and len(topic_info) > 1:
                top_3 = topic_info[topic_info['Topic'] != -1].head(3)
                logger.info("  🔝 Top 3 topics:")
                for _, topic in top_3.iterrows():
                    topic_id = topic['Topic']
                    words = results['top_words_per_topic'].get(topic_id, [])
                    # Show key content words (skip generic maker terms)
                    content_words = [w for w in words[:5] if w not in ['diy', 'make', 'build', 'project']]
                    logger.info(f"    Topic {topic_id}: {', '.join(content_words[:3])} ({topic['Count']} videos)")

def main():
    import sys
    
    # Check for input file argument
    if len(sys.argv) > 1:
        data_file = sys.argv[1]
    else:
        # Look for improved cleaned file first
        improved_files = [
            '/Users/brandoncullum/video-scripter/exports/improved-cleaned-titles-2025-07-10_17-43-29.json',
            '/Users/brandoncullum/video-scripter/exports/minimal-cleaned-titles-for-bertopic-2025-07-10_11-50-48.json',
            '/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json'
        ]
        
        data_file = None
        for file_path in improved_files:
            if os.path.exists(file_path):
                data_file = file_path
                break
                
        if not data_file:
            logger.error("No suitable input file found")
            return
    
    if not os.path.exists(data_file):
        logger.error(f"Data file not found: {data_file}")
        return
    
    logger.info(f"Using dataset: {data_file}")
    
    analyzer = ImprovedBERTopicAnalyzer(data_file)
    analyzer.run_complete_analysis()
    
    logger.info("\n🎯 Improved analysis complete!")
    logger.info("📁 Check exports/ directory for results")
    logger.info("🔍 Review cluster quality before proceeding with naming")

if __name__ == "__main__":
    main()