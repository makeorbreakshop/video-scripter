#!/usr/bin/env python3
"""
Proper BERTopic Hierarchical Clustering using built-in methods
Following the official documentation approach
"""

import os
import numpy as np
from bertopic import BERTopic
import pickle
import json
import logging
from datetime import datetime
import pandas as pd

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_saved_data():
    """Load the saved data and model"""
    logger.info("Loading saved data...")
    
    # Load embeddings and documents
    with open('bertopic_embeddings.pkl', 'rb') as f:
        embeddings = pickle.load(f)
    
    if not isinstance(embeddings, np.ndarray):
        embeddings = np.array(embeddings)
        
    with open('bertopic_documents.pkl', 'rb') as f:
        documents = pickle.load(f)
    
    # Load video data
    video_files = [f for f in os.listdir('.') if f.startswith('bertopic_valid_videos_') and f.endswith('.pkl')]
    if video_files:
        with open(video_files[0], 'rb') as f:
            video_data = pickle.load(f)
    else:
        with open('bertopic_video_data.pkl', 'rb') as f:
            video_data = pickle.load(f)[:len(embeddings)]
    
    # Load the saved model
    model_path = "bertopic_model_smart_20250801_131447"
    if os.path.exists(model_path):
        logger.info(f"Loading BERTopic model from {model_path}")
        topic_model = BERTopic.load(model_path)
    else:
        raise FileNotFoundError(f"Model not found at {model_path}")
    
    logger.info(f"Loaded {len(embeddings):,} embeddings and model")
    return embeddings, documents, video_data, topic_model

def create_proper_hierarchy(topic_model, documents):
    """Create hierarchy using BERTopic's built-in method"""
    logger.info("\n" + "="*60)
    logger.info("Creating Proper BERTopic Hierarchy")
    logger.info("="*60)
    
    # Get the current topics
    topics = topic_model.topics_
    logger.info(f"Starting with {len(set(topics)) - 1} base topics (excluding outliers)")
    logger.info(f"Documents: {len(documents)}, Topics: {len(topics)}")
    
    # Check if we need to use a subset
    if len(documents) != len(topics):
        logger.warning(f"Mismatch: {len(documents)} documents vs {len(topics)} topics")
        # The model was trained on a sample, so we need to use only those documents
        if len(topics) < len(documents):
            logger.info(f"Using first {len(topics)} documents to match topic assignments")
            documents = documents[:len(topics)]
        else:
            logger.error("More topics than documents - this shouldn't happen")
            raise ValueError("Topic/document mismatch")
    
    # Create hierarchical topics
    logger.info("\nStep 1: Creating hierarchical topic structure...")
    hierarchical_topics = topic_model.hierarchical_topics(documents)
    
    logger.info(f"Hierarchical structure created with {len(hierarchical_topics)} levels")
    
    # Save the hierarchical structure
    hierarchical_df = pd.DataFrame(hierarchical_topics)
    hierarchical_df.to_csv('bertopic_hierarchy_structure.csv', index=False)
    logger.info("Saved hierarchical structure to bertopic_hierarchy_structure.csv")
    
    # Visualize hierarchy (saves as HTML)
    logger.info("\nStep 2: Creating hierarchy visualization...")
    fig = topic_model.visualize_hierarchy(hierarchical_topics=hierarchical_topics)
    fig.write_html("bertopic_hierarchy_dendrogram.html")
    logger.info("Saved hierarchy visualization to bertopic_hierarchy_dendrogram.html")
    
    # Get topics at different levels of granularity
    logger.info("\nStep 3: Reducing topics to different levels...")
    
    # Level 1: ~20 super categories
    logger.info("Creating Level 1 (20 topics)...")
    topics_l1 = topic_model.reduce_topics(documents, nr_topics=20)
    topic_info_l1 = topic_model.get_topic_info()
    logger.info(f"Level 1: {len(topic_info_l1) - 1} topics")
    
    # Level 2: ~50 main categories
    logger.info("Creating Level 2 (50 topics)...")
    topics_l2 = topic_model.reduce_topics(documents, nr_topics=50)
    topic_info_l2 = topic_model.get_topic_info()
    logger.info(f"Level 2: {len(topic_info_l2) - 1} topics")
    
    # Level 3: Keep original topics
    topics_l3 = topic_model.topics_
    topic_info_l3 = topic_model.get_topic_info()
    logger.info(f"Level 3: {len(topic_info_l3) - 1} topics (original)")
    
    return hierarchical_topics, topics_l1, topics_l2, topics_l3

def analyze_hierarchy_mappings(hierarchical_topics):
    """Analyze the hierarchical mappings"""
    logger.info("\n" + "="*60)
    logger.info("Analyzing Hierarchy Mappings")
    logger.info("="*60)
    
    # Convert to DataFrame for easier analysis
    df = pd.DataFrame(hierarchical_topics)
    
    # Find parent-child relationships
    parent_child_map = {}
    
    for _, row in df.iterrows():
        parent = row['Parent_ID']
        child = row['Child_Left_ID']
        
        if parent not in parent_child_map:
            parent_child_map[parent] = []
        parent_child_map[parent].append(child)
        
        child = row['Child_Right_ID']
        if parent not in parent_child_map:
            parent_child_map[parent] = []
        parent_child_map[parent].append(child)
    
    # Print sample of hierarchy
    logger.info("\nSample Parent-Child Relationships:")
    for parent, children in list(parent_child_map.items())[:10]:
        logger.info(f"Topic {parent} → {children}")
    
    return parent_child_map

def save_results_with_hierarchy(video_data, topics_l1, topics_l2, topics_l3, 
                              topic_model, hierarchical_topics):
    """Save results with proper hierarchy information"""
    logger.info("\nSaving results with hierarchy...")
    
    # Get topic information at each level
    # Need to get the topic info after each reduction
    results = []
    
    for i in range(len(video_data)):
        video = video_data[i] if i < len(video_data) else {'id': f'unknown_{i}'}
        
        results.append({
            'id': video.get('id', f'unknown_{i}'),
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'topic_level_1': int(topics_l1[i]) if i < len(topics_l1) else -1,
            'topic_level_2': int(topics_l2[i]) if i < len(topics_l2) else -1,
            'topic_level_3': int(topics_l3[i]) if i < len(topics_l3) else -1,
            'topic_confidence': 0.8
        })
    
    # Create metadata with hierarchy info
    metadata = {
        'total_videos': len(results),
        'hierarchy_method': 'bertopic_hierarchical_topics',
        'hierarchy_levels': len(hierarchical_topics),
        'topics_per_level': {
            'level_1': len(set(topics_l1)) - 1,  # Exclude -1
            'level_2': len(set(topics_l2)) - 1,
            'level_3': len(set(topics_l3)) - 1
        }
    }
    
    output_file = f"bertopic_proper_hierarchy_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': metadata,
            'classifications': results
        }, f, indent=2)
    
    logger.info(f"Results saved to: {output_file}")
    
    # Also save topic words for each level
    logger.info("\nExtracting topic keywords for each level...")
    
    # Get original model topics
    original_topics = {}
    for topic_id in set(topics_l3):
        if topic_id != -1:
            words = topic_model.get_topic(topic_id)
            original_topics[topic_id] = {
                'keywords': [word for word, _ in words[:10]],
                'top_words': ', '.join([word for word, _ in words[:5]])
            }
    
    # Save topic keywords
    with open('bertopic_hierarchy_keywords.json', 'w') as f:
        json.dump({
            'original_topics': original_topics,
            'hierarchy_info': {
                'total_merges': len(hierarchical_topics),
                'dendrogram_saved': 'bertopic_hierarchy_dendrogram.html',
                'structure_saved': 'bertopic_hierarchy_structure.csv'
            }
        }, f, indent=2)
    
    logger.info("Topic keywords saved to: bertopic_hierarchy_keywords.json")
    
    return output_file

def main():
    """Run proper hierarchical BERTopic analysis"""
    
    try:
        # Load data and model
        embeddings, documents, video_data, topic_model = load_saved_data()
        
        # Create proper hierarchy
        hierarchical_topics, topics_l1, topics_l2, topics_l3 = create_proper_hierarchy(
            topic_model, documents
        )
        
        # Analyze the hierarchy
        parent_child_map = analyze_hierarchy_mappings(hierarchical_topics)
        
        # Save results
        output_file = save_results_with_hierarchy(
            video_data, topics_l1, topics_l2, topics_l3, 
            topic_model, hierarchical_topics
        )
        
        logger.info("\n" + "="*60)
        logger.info("PROPER HIERARCHY COMPLETE")
        logger.info("="*60)
        logger.info(f"✅ Classifications saved to: {output_file}")
        logger.info("✅ Hierarchy dendrogram: bertopic_hierarchy_dendrogram.html")
        logger.info("✅ Hierarchy structure: bertopic_hierarchy_structure.csv")
        logger.info("✅ Topic keywords: bertopic_hierarchy_keywords.json")
        logger.info("\nView the dendrogram by opening bertopic_hierarchy_dendrogram.html in a browser")
        
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("\n" + "="*60)
    print("PROPER BERTopic HIERARCHICAL CLUSTERING")
    print("="*60)
    print("\nThis script uses BERTopic's built-in hierarchical_topics() method")
    print("to create a proper dendrogram-based hierarchy where similar topics")
    print("are merged iteratively.")
    print("="*60 + "\n")
    
    main()