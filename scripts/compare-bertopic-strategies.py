#!/usr/bin/env python3
"""
Compare BERTopic clustering results using different embedding strategies
"""

import json
import numpy as np
from bertopic import BERTopic
from sklearn.metrics import silhouette_score
from collections import defaultdict
import pandas as pd

print("🔬 Comparing BERTopic Results: Title-Only vs Combined Embeddings")
print("=" * 60)

# Load the test embeddings
with open('outputs/combined_embeddings_test.json', 'r') as f:
    data = json.load(f)

videos = data['data']
print(f"Loaded {len(videos)} videos with embeddings")

# Extract embeddings for each strategy
strategies = {
    'title_only': [],
    'title_weighted': [],
    'title_with_context': []
}

titles = []
channels = []

for video in videos:
    titles.append(video['title'])
    channels.append(video['channel'])
    
    for strategy in strategies:
        strategies[strategy].append(video['embeddings'][strategy])

# Convert to numpy arrays
for strategy in strategies:
    strategies[strategy] = np.array(strategies[strategy])

# Run BERTopic on each strategy
results = {}

for strategy_name, embeddings in strategies.items():
    print(f"\n🎯 Testing strategy: {strategy_name}")
    print("-" * 40)
    
    # Configure BERTopic with small min_cluster_size for testing
    topic_model = BERTopic(
        min_topic_size=2,  # Small for testing
        nr_topics='auto',
        calculate_probabilities=True,
        verbose=False
    )
    
    # Fit the model
    topics, probs = topic_model.fit_transform(titles, embeddings)
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude outlier topic -1
    
    # Calculate metrics
    # Silhouette score (higher is better, -1 to 1)
    if n_topics > 1:
        silhouette = silhouette_score(embeddings, topics)
    else:
        silhouette = -1
    
    # Topic diversity (unique topics per channel)
    channel_topics = defaultdict(set)
    for i, (channel, topic) in enumerate(zip(channels, topics)):
        if topic != -1:  # Exclude outliers
            channel_topics[channel].add(topic)
    
    avg_topics_per_channel = np.mean([len(topics) for topics in channel_topics.values()])
    
    # Store results
    results[strategy_name] = {
        'model': topic_model,
        'topics': topics,
        'n_topics': n_topics,
        'silhouette_score': silhouette,
        'avg_topics_per_channel': avg_topics_per_channel,
        'outliers': sum(1 for t in topics if t == -1)
    }
    
    print(f"  Topics found: {n_topics}")
    print(f"  Silhouette score: {silhouette:.3f}")
    print(f"  Outliers: {results[strategy_name]['outliers']}")
    print(f"  Avg topics/channel: {avg_topics_per_channel:.2f}")

# Compare topic assignments
print("\n📊 Topic Assignment Comparison")
print("-" * 40)

# Show how topics differ for the same videos
for i in range(min(10, len(titles))):  # Show first 10
    title = titles[i][:50] + "..."
    topics_by_strategy = {
        strategy: results[strategy]['topics'][i] 
        for strategy in strategies
    }
    
    # Check if all strategies agree
    unique_topics = set(topics_by_strategy.values())
    if len(unique_topics) > 1:
        print(f"\n{title}")
        for strategy in strategies:
            topic = topics_by_strategy[strategy]
            if topic != -1:
                # Get top words for this topic
                topic_words = results[strategy]['model'].get_topic(topic)
                top_words = ', '.join([word for word, _ in topic_words[:3]])
                print(f"  {strategy}: Topic {topic} ({top_words})")
            else:
                print(f"  {strategy}: Outlier")

# Summary
print("\n📈 SUMMARY")
print("=" * 60)

best_strategy = max(results.keys(), key=lambda k: results[k]['silhouette_score'])
print(f"\nBest clustering quality: {best_strategy}")
print(f"  Silhouette score: {results[best_strategy]['silhouette_score']:.3f}")
print(f"  Topics found: {results[best_strategy]['n_topics']}")

print("\nRecommendation:")
if results['title_weighted']['silhouette_score'] > results['title_only']['silhouette_score'] * 1.1:
    print("✅ Combined embeddings show significant improvement!")
    print("   The transcript content helps create more coherent topic clusters.")
else:
    print("⚠️  Combined embeddings show minimal improvement.")
    print("   Consider testing with more videos or different weighting.")

# Save detailed results
output_file = 'outputs/bertopic_comparison_results.json'
save_data = {
    'comparison_date': data['test_date'],
    'videos_tested': len(videos),
    'results': {
        strategy: {
            'n_topics': results[strategy]['n_topics'],
            'silhouette_score': float(results[strategy]['silhouette_score']),
            'outliers': results[strategy]['outliers'],
            'avg_topics_per_channel': float(results[strategy]['avg_topics_per_channel'])
        }
        for strategy in strategies
    }
}

with open(output_file, 'w') as f:
    json.dump(save_data, f, indent=2)

print(f"\n💾 Detailed results saved to {output_file}")