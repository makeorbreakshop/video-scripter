#!/usr/bin/env python3
"""
BERTopic Clustering Comparison: Title vs Summary vs Combined
Uses pre-fetched data from Node.js script
"""

import json
import numpy as np
import pandas as pd
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from sentence_transformers import SentenceTransformer
from datetime import datetime
import os
from collections import Counter

def load_data(filename):
    """Load data from JSON file"""
    print(f"📥 Loading data from {filename}...")
    
    with open(filename, 'r') as f:
        data = json.load(f)
    
    metadata = data['metadata']
    videos = pd.DataFrame(data['videos'])
    text_vars = data['text_variations']
    
    print(f"✅ Loaded {len(videos)} videos")
    print(f"   - Unique channels: {metadata['unique_channels']}")
    print(f"   - Date range: {datetime.fromtimestamp(metadata['date_range']['earliest']/1000).strftime('%Y-%m')} to {datetime.fromtimestamp(metadata['date_range']['latest']/1000).strftime('%Y-%m')}")
    
    return videos, text_vars, metadata

def run_bertopic_analysis(texts, name, min_topic_size=15):
    """Run BERTopic clustering"""
    print(f"\n{'='*50}")
    print(f"🧠 Running BERTopic: {name}")
    print(f"{'='*50}")
    
    # Use a lightweight model for speed
    sentence_model = SentenceTransformer("all-MiniLM-L6-v2")
    
    # Vectorizer optimized for YouTube content
    vectorizer = CountVectorizer(
        ngram_range=(1, 2),
        stop_words="english",
        min_df=2,
        max_df=0.9,
        max_features=1000
    )
    
    # Create BERTopic model
    topic_model = BERTopic(
        embedding_model=sentence_model,
        vectorizer_model=vectorizer,
        min_topic_size=min_topic_size,
        verbose=True,
        calculate_probabilities=False  # Faster without probabilities
    )
    
    print(f"📊 Processing {len(texts)} documents...")
    topics, _ = topic_model.fit_transform(texts)
    
    # Get results
    topic_info = topic_model.get_topic_info()
    outliers = sum(1 for t in topics if t == -1)
    
    print(f"✅ Results:")
    print(f"   - Topics found: {len(topic_info) - 1}")
    print(f"   - Outliers: {outliers} ({outliers/len(topics)*100:.1f}%)")
    print(f"   - Largest topic: {topic_info.iloc[1]['Count'] if len(topic_info) > 1 else 0} videos")
    
    return topic_model, topics, topic_info

def analyze_topic_quality(videos_df, topics, topic_model, name):
    """Analyze clustering quality"""
    print(f"\n📊 Quality Analysis: {name}")
    
    # Add topics to dataframe  
    analysis_df = videos_df.copy()
    analysis_df['topic'] = topics
    
    # Channel diversity per topic
    topic_channel_diversity = []
    for topic_id in analysis_df['topic'].unique():
        if topic_id == -1:  # Skip outliers
            continue
            
        topic_videos = analysis_df[analysis_df['topic'] == topic_id]
        unique_channels = topic_videos['channel_name'].nunique()
        total_videos = len(topic_videos)
        diversity_ratio = unique_channels / total_videos if total_videos > 0 else 0
        
        topic_channel_diversity.append({
            'topic': topic_id,
            'size': total_videos,
            'unique_channels': unique_channels,
            'diversity_ratio': diversity_ratio
        })
    
    if topic_channel_diversity:
        diversity_df = pd.DataFrame(topic_channel_diversity)
        avg_diversity = diversity_df['diversity_ratio'].mean()
        print(f"   - Average channel diversity: {avg_diversity:.3f}")
        print(f"   - Topics with high diversity (>0.7): {sum(diversity_df['diversity_ratio'] > 0.7)}")
    else:
        print("   - No valid topics found (all outliers)")
        diversity_df = pd.DataFrame()
    
    # Show top 3 topics with examples
    topic_info = topic_model.get_topic_info()
    print(f"\n🏷️  Top 3 Topics:")
    for i in range(min(3, len(topic_info) - 1)):
        topic_id = topic_info.iloc[i+1]['Topic']  # Skip outliers at index 0
        topic_words = topic_model.get_topic(topic_id)
        topic_videos = analysis_df[analysis_df['topic'] == topic_id]
        
        words = ', '.join([word for word, _ in topic_words[:5]])
        count = len(topic_videos)
        examples = topic_videos['title'].head(2).tolist()
        
        print(f"   Topic {topic_id} ({count} videos): {words}")
        print(f"     Examples: {examples}")
    
    return analysis_df, diversity_df

def compare_results(results):
    """Compare all methods"""
    print(f"\n{'='*70}")
    print("🔍 COMPARISON SUMMARY")
    print(f"{'='*70}")
    
    comparison_data = []
    
    for method_name, (model, topics, topic_info, analysis_df, diversity_df) in results.items():
        outlier_count = sum(1 for t in topics if t == -1)
        total_topics = len(topic_info) - 1
        avg_diversity = diversity_df['diversity_ratio'].mean() if len(diversity_df) > 0 else 0
        
        comparison_data.append({
            'Method': method_name,
            'Topics': total_topics,
            'Outliers': f"{outlier_count} ({outlier_count/len(topics)*100:.1f}%)",
            'Avg Diversity': f"{avg_diversity:.3f}",
            'Best For': get_method_recommendation(method_name, total_topics, outlier_count/len(topics), avg_diversity)
        })
    
    # Print comparison table
    df_comparison = pd.DataFrame(comparison_data)
    print(df_comparison.to_string(index=False))
    
    return df_comparison

def get_method_recommendation(method, topics, outlier_ratio, diversity):
    """Get recommendation for each method"""
    if method == "Title-Only":
        if topics > 20 and outlier_ratio < 0.3:
            return "Quick categorization"
        else:
            return "Limited by title brevity"
    elif method == "Summary-Only":
        if diversity > 0.5 and topics > 15:
            return "Detailed content analysis"
        else:
            return "May be too specific"
    else:  # Combined
        if topics > 10 and outlier_ratio < 0.4 and diversity > 0.4:
            return "Best overall balance"
        else:
            return "Good for comprehensive view"

def save_results(results, output_dir="bertopic_results"):
    """Save all results"""
    os.makedirs(output_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    summary = {
        'timestamp': timestamp,
        'methods': {}
    }
    
    for method_name, (model, topics, topic_info, analysis_df, diversity_df) in results.items():
        # Save topic assignments
        filename = f"{method_name.lower().replace('-', '_').replace(' ', '_')}"
        analysis_df[['id', 'title', 'channel_name', 'topic']].to_csv(
            f"{output_dir}/{filename}_assignments.csv", index=False
        )
        
        # Save topic info
        topic_info.to_csv(f"{output_dir}/{filename}_topics.csv", index=False)
        
        # Add to summary
        summary['methods'][method_name] = {
            'total_topics': len(topic_info) - 1,
            'outliers': sum(1 for t in topics if t == -1),
            'outlier_percentage': sum(1 for t in topics if t == -1) / len(topics) * 100,
            'avg_diversity': float(diversity_df['diversity_ratio'].mean()) if len(diversity_df) > 0 else 0.0
        }
    
    # Save summary
    with open(f"{output_dir}/comparison_summary.json", 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\n💾 Results saved to {output_dir}/")
    return output_dir

def main():
    print("🚀 BERTopic Clustering Comparison")
    print("="*50)
    
    # Load data
    data_file = "bertopic_data_2025-07-30.json"
    if not os.path.exists(data_file):
        print(f"❌ Data file {data_file} not found!")
        print("Run the Node.js script first: node scripts/bertopic-comparison-js.cjs")
        return
    
    videos_df, text_variations, metadata = load_data(data_file)
    
    # Run clustering for each method
    results = {}
    methods = [
        ("Title-Only", text_variations['titles']),
        ("Summary-Only", text_variations['summaries']),
        ("Combined", text_variations['combined'])
    ]
    
    for method_name, texts in methods:
        # Run clustering - adjust min_topic_size based on dataset size
        min_size = max(20, len(texts) // 200)  # Dynamic sizing: ~0.5% of dataset, min 20
        model, topics, topic_info = run_bertopic_analysis(texts, method_name, min_topic_size=min_size)
        
        # Analyze quality
        analysis_df, diversity_df = analyze_topic_quality(videos_df, topics, model, method_name)
        
        # Store results
        results[method_name] = (model, topics, topic_info, analysis_df, diversity_df)
    
    # Compare all methods
    comparison_df = compare_results(results)
    
    # Save results
    output_dir = save_results(results)
    
    print(f"\n✅ Analysis complete!")
    print(f"📊 Check {output_dir}/ for detailed results")
    print(f"\n💡 Quick insights:")
    print(f"   - Best for quick categorization: Title-Only")
    print(f"   - Best for content depth: Summary-Only") 
    print(f"   - Best overall balance: Combined")

if __name__ == "__main__":
    main()