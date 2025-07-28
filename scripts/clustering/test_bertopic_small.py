#!/usr/bin/env python3
"""
Test BERTopic on a small sample to verify setup
"""
import os
import sys
import json
import numpy as np
from datetime import datetime

print("Testing BERTopic setup...")
print("-" * 50)

# Check imports
try:
    from sentence_transformers import SentenceTransformer
    print("✅ sentence-transformers installed")
except ImportError:
    print("❌ sentence-transformers NOT installed")
    print("   Run: pip install sentence-transformers")
    sys.exit(1)

try:
    from bertopic import BERTopic
    print("✅ bertopic installed")
except ImportError:
    print("❌ bertopic NOT installed")
    print("   Run: pip install bertopic")
    sys.exit(1)

try:
    import umap
    print("✅ umap-learn installed")
except ImportError:
    print("❌ umap-learn NOT installed")
    print("   Run: pip install umap-learn")
    sys.exit(1)

try:
    import hdbscan
    print("✅ hdbscan installed")
except ImportError:
    print("❌ hdbscan NOT installed")
    print("   Run: pip install hdbscan")
    sys.exit(1)

# Test with sample data
print("\n" + "-" * 50)
print("Creating sample documents...")

# Sample YouTube video titles (educational content)
sample_titles = [
    # Python tutorials
    "Python Tutorial for Beginners - Learn Python in 5 Hours",
    "Python Crash Course For Beginners",
    "Learn Python Programming - Full Course",
    "Python for Data Science - Complete Tutorial",
    "Python Web Development with Django",
    
    # JavaScript tutorials
    "JavaScript Tutorial for Beginners - Complete Course",
    "Learn JavaScript in 1 Hour",
    "JavaScript ES6 Tutorial",
    "React JS Crash Course 2024",
    "Node.js Tutorial for Beginners",
    
    # Machine Learning
    "Machine Learning Course for Beginners",
    "Deep Learning Fundamentals",
    "TensorFlow 2.0 Complete Tutorial",
    "PyTorch for Deep Learning",
    "Neural Networks Explained",
    
    # Web Development
    "HTML CSS Tutorial for Beginners",
    "Full Stack Web Development Course",
    "Build a Website from Scratch",
    "Responsive Web Design Tutorial",
    "CSS Grid Layout Complete Guide",
    
    # Data Science
    "Data Analysis with Python - Pandas Tutorial",
    "SQL Tutorial - Full Database Course",
    "Data Visualization with Matplotlib",
    "Statistics for Data Science",
    "NumPy Tutorial - Complete Guide"
]

print(f"Sample size: {len(sample_titles)} documents")

# Initialize SBERT model
print("\n" + "-" * 50)
print("Loading SBERT model...")
try:
    model = SentenceTransformer('all-MiniLM-L6-v2')
    print("✅ SBERT model loaded successfully")
    print(f"   Model: all-MiniLM-L6-v2")
    print(f"   Embedding dimension: {model.get_sentence_embedding_dimension()}")
except Exception as e:
    print(f"❌ Error loading SBERT model: {e}")
    sys.exit(1)

# Generate embeddings
print("\n" + "-" * 50)
print("Generating SBERT embeddings...")
try:
    embeddings = model.encode(sample_titles, show_progress_bar=True)
    print(f"✅ Generated embeddings shape: {embeddings.shape}")
except Exception as e:
    print(f"❌ Error generating embeddings: {e}")
    sys.exit(1)

# Run BERTopic
print("\n" + "-" * 50)
print("Running BERTopic clustering...")
try:
    # Create BERTopic model with small min_cluster_size for test
    topic_model = BERTopic(
        min_topic_size=2,  # Small for test data
        nr_topics="auto",
        calculate_probabilities=True,
        verbose=True
    )
    
    # Fit the model
    topics, probs = topic_model.fit_transform(sample_titles, embeddings)
    
    print(f"\n✅ BERTopic clustering complete!")
    print(f"   Number of topics found: {len(set(topics)) - 1}")  # -1 to exclude outliers
    print(f"   Topics: {set(topics)}")
    
    # Show topic info
    topic_info = topic_model.get_topic_info()
    print("\nTopic Information:")
    print(topic_info[['Topic', 'Count', 'Name']].head(10))
    
    # Show documents per topic
    print("\n" + "-" * 50)
    print("Documents per topic:")
    for topic in sorted(set(topics)):
        if topic != -1:  # Skip outliers
            docs_in_topic = [sample_titles[i] for i, t in enumerate(topics) if t == topic]
            print(f"\nTopic {topic}: ({len(docs_in_topic)} documents)")
            for doc in docs_in_topic[:3]:  # Show first 3
                print(f"  - {doc}")
            
except Exception as e:
    print(f"❌ Error running BERTopic: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Save test results
print("\n" + "-" * 50)
print("Saving test results...")
results = {
    "test_date": datetime.now().isoformat(),
    "sample_size": len(sample_titles),
    "sbert_model": "all-MiniLM-L6-v2",
    "embedding_dim": embeddings.shape[1],
    "topics_found": len(set(topics)) - 1,
    "topic_assignments": [{"title": title, "topic": int(topic)} for title, topic in zip(sample_titles, topics)]
}

with open('bertopic_test_results.json', 'w') as f:
    json.dump(results, f, indent=2)

print("✅ Test results saved to bertopic_test_results.json")
print("\n" + "=" * 50)
print("🎉 SUCCESS! BERTopic is working correctly")
print("=" * 50)
print("\nNext steps:")
print("1. Review the test results")
print("2. If clustering looks good, run on full dataset")
print("3. Expected time for 170K videos: ~30-40 minutes")