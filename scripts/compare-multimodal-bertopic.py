#!/usr/bin/env python3

"""
Compare BERTopic clustering results between:
1. Title-only embeddings
2. Title + Thumbnail multimodal embeddings
"""

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
from collections import Counter
import matplotlib.pyplot as plt
import seaborn as sns

def load_embeddings(filename='bertopic_comparison_data.json'):
    """Load the embedding datasets"""
    with open(filename, 'r') as f:
        data = json.load(f)
    return data

def run_bertopic_analysis(embeddings, min_topic_size=3):
    """Run BERTopic on embeddings and return results"""
    # Extract embedding vectors and documents
    vectors = np.array([item['embedding'] for item in embeddings])
    documents = [item['metadata']['title'] for item in embeddings]
    
    # Run BERTopic with pre-computed embeddings
    topic_model = BERTopic(
        min_topic_size=min_topic_size,
        n_gram_range=(1, 3),
        calculate_probabilities=True,
        verbose=False
    )
    
    # Use pre-computed embeddings
    topics, probs = topic_model.fit_transform(documents, embeddings=vectors)
    
    return topic_model, topics, probs, vectors

def analyze_clustering_quality(vectors, topics):
    """Calculate clustering quality metrics"""
    # Filter out outliers (topic -1)
    topics_array = np.array(topics)
    mask = topics_array != -1
    if np.sum(mask) < 2:
        return {"silhouette_score": 0, "num_clusters": 0}
    
    silhouette = silhouette_score(vectors[mask], topics_array[mask])
    num_clusters = len(set(topics)) - (1 if -1 in topics else 0)
    
    return {
        "silhouette_score": silhouette,
        "num_clusters": num_clusters,
        "outliers": sum(topics == -1),
        "total_videos": len(topics)
    }

def compare_approaches():
    """Main comparison function"""
    print("🎯 Multimodal BERTopic Comparison\n")
    
    # Load data
    data = load_embeddings()
    
    results = {}
    
    for approach_name, embeddings in data.items():
        print(f"\n📊 Analyzing {approach_name}...")
        
        # Run BERTopic
        model, topics, probs, vectors = run_bertopic_analysis(embeddings)
        
        # Analyze quality
        quality = analyze_clustering_quality(vectors, topics)
        
        # Get topic info
        topic_info = model.get_topic_info()
        
        # Store results
        results[approach_name] = {
            "model": model,
            "topics": topics,
            "quality": quality,
            "topic_info": topic_info
        }
        
        print(f"  ✅ Found {quality['num_clusters']} topics")
        print(f"  📈 Silhouette score: {quality['silhouette_score']:.3f}")
        print(f"  🔍 Outliers: {quality['outliers']}/{quality['total_videos']}")
    
    return results

def print_topic_comparison(results):
    """Print detailed topic comparison"""
    print("\n" + "="*60)
    print("DETAILED TOPIC COMPARISON")
    print("="*60)
    
    for approach, data in results.items():
        print(f"\n🔹 {approach.upper()}")
        print("-" * 40)
        
        # Get top 5 topics (excluding outliers)
        topic_info = data['topic_info']
        top_topics = topic_info[topic_info['Topic'] != -1].head(5)
        
        for _, row in top_topics.iterrows():
            print(f"\nTopic {row['Topic']} ({row['Count']} videos):")
            # Extract top words
            words = row['Name'].split('_')[1:]  # Remove topic number
            print(f"  Keywords: {', '.join(words[:5])}")
    
    # Quality comparison
    print("\n" + "="*60)
    print("QUALITY METRICS COMPARISON")
    print("="*60)
    
    metrics_table = []
    for approach, data in results.items():
        q = data['quality']
        metrics_table.append([
            approach,
            q['num_clusters'],
            f"{q['silhouette_score']:.3f}",
            f"{q['outliers']}/{q['total_videos']}"
        ])
    
    # Print table
    headers = ["Approach", "Topics", "Silhouette", "Outliers"]
    col_widths = [max(len(str(row[i])) for row in [headers] + metrics_table) + 2 
                  for i in range(len(headers))]
    
    # Header
    print("\n" + " | ".join(h.ljust(w) for h, w in zip(headers, col_widths)))
    print("-" * (sum(col_widths) + 3 * (len(headers) - 1)))
    
    # Rows
    for row in metrics_table:
        print(" | ".join(str(val).ljust(w) for val, w in zip(row, col_widths)))

def visualize_results(results):
    """Create visualization comparing approaches"""
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    
    for idx, (approach, data) in enumerate(results.items()):
        ax = axes[idx]
        
        # Topic distribution
        topics = data['topics']
        topic_counts = Counter(t for t in topics if t != -1)
        
        if topic_counts:
            ax.bar(topic_counts.keys(), topic_counts.values())
            ax.set_title(f'{approach}\n{data["quality"]["num_clusters"]} topics')
            ax.set_xlabel('Topic ID')
            ax.set_ylabel('Number of Videos')
        else:
            ax.text(0.5, 0.5, 'No topics found', ha='center', va='center')
            ax.set_title(approach)
    
    plt.tight_layout()
    plt.savefig('multimodal_bertopic_comparison.png', dpi=150, bbox_inches='tight')
    print("\n📊 Saved visualization to multimodal_bertopic_comparison.png")

def main():
    """Run the complete analysis"""
    # Run comparison
    results = compare_approaches()
    
    # Print detailed comparison
    print_topic_comparison(results)
    
    # Create visualization
    visualize_results(results)
    
    # Winner determination
    print("\n" + "="*60)
    print("🏆 WINNER DETERMINATION")
    print("="*60)
    
    # Calculate scores
    scores = {}
    for approach, data in results.items():
        q = data['quality']
        # Score based on: more topics (better granularity) + higher silhouette + fewer outliers
        score = (q['num_clusters'] * 10 + 
                q['silhouette_score'] * 100 - 
                (q['outliers'] / q['total_videos']) * 50)
        scores[approach] = score
    
    winner = max(scores, key=scores.get)
    print(f"\n🥇 Best approach: {winner}")
    print(f"   Score: {scores[winner]:.2f}")
    print("\nScoring formula: (num_topics × 10) + (silhouette × 100) - (outlier_ratio × 50)")

if __name__ == "__main__":
    main()