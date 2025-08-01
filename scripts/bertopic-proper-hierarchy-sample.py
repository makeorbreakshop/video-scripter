#!/usr/bin/env python3
"""
Proper BERTopic Hierarchical Clustering using the sample data
Since the model was trained on a 30K sample, we'll create the hierarchy from that
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

def load_sample_data():
    """Load the sample data that was used to train the model"""
    logger.info("Loading sample data...")
    
    # Load the sample indices
    with open('bertopic_sample_indices.pkl', 'rb') as f:
        sample_indices = pickle.load(f)
    
    # Load all documents
    with open('bertopic_documents.pkl', 'rb') as f:
        all_documents = pickle.load(f)
    
    # Get sample documents
    sample_documents = [all_documents[i] for i in sample_indices]
    
    # Load the model
    model_path = "bertopic_model_smart_20250801_131447"
    logger.info(f"Loading BERTopic model from {model_path}")
    topic_model = BERTopic.load(model_path)
    
    logger.info(f"Loaded {len(sample_documents):,} sample documents")
    logger.info(f"Model has {len(topic_model.topics_)} topic assignments")
    
    return sample_documents, topic_model, sample_indices

def create_proper_hierarchy(topic_model, documents):
    """Create hierarchy using BERTopic's built-in method"""
    logger.info("\n" + "="*60)
    logger.info("Creating Proper BERTopic Hierarchy")
    logger.info("="*60)
    
    # Get unique topics
    unique_topics = set(topic_model.topics_)
    logger.info(f"Starting with {len(unique_topics) - (1 if -1 in unique_topics else 0)} topics (excluding outliers)")
    
    # Create hierarchical topics
    logger.info("\nStep 1: Creating hierarchical topic structure...")
    hierarchical_topics = topic_model.hierarchical_topics(documents)
    
    logger.info(f"Hierarchical structure created with {len(hierarchical_topics)} merges")
    
    # Save the hierarchical structure
    hierarchical_df = pd.DataFrame(hierarchical_topics)
    hierarchical_df.to_csv('bertopic_hierarchy_structure.csv', index=False)
    logger.info("Saved hierarchical structure to bertopic_hierarchy_structure.csv")
    
    # Visualize hierarchy
    logger.info("\nStep 2: Creating hierarchy visualization...")
    fig = topic_model.visualize_hierarchy(hierarchical_topics=hierarchical_topics)
    fig.write_html("bertopic_hierarchy_dendrogram.html")
    logger.info("Saved hierarchy visualization to bertopic_hierarchy_dendrogram.html")
    
    # Analyze merge distances
    logger.info("\nStep 3: Analyzing merge distances to find natural breakpoints...")
    distances = hierarchical_df['Distance'].values
    
    # Find large jumps in merge distance (natural hierarchy levels)
    distance_diffs = np.diff(distances)
    large_jumps = np.where(distance_diffs > np.percentile(distance_diffs, 90))[0]
    
    logger.info(f"Found {len(large_jumps)} significant jumps in merge distance")
    
    # Suggest hierarchy levels based on topic count
    n_topics_original = len(unique_topics) - (1 if -1 in unique_topics else 0)
    suggested_levels = {
        'fine': n_topics_original,
        'medium': min(50, n_topics_original // 4),
        'coarse': min(20, n_topics_original // 10)
    }
    
    logger.info(f"\nSuggested hierarchy levels:")
    logger.info(f"  Fine-grained: {suggested_levels['fine']} topics")
    logger.info(f"  Medium: {suggested_levels['medium']} topics")
    logger.info(f"  Coarse: {suggested_levels['coarse']} topics")
    
    # Reduce topics to different levels
    logger.info("\nStep 4: Reducing topics to different granularity levels...")
    
    # Keep original for fine-grained
    topics_fine = topic_model.topics_.copy()
    
    # Medium level
    logger.info(f"Creating medium level ({suggested_levels['medium']} topics)...")
    topic_model_medium = topic_model.reduce_topics(documents, nr_topics=suggested_levels['medium'])
    topics_medium = topic_model_medium.topics_
    
    # Coarse level
    logger.info(f"Creating coarse level ({suggested_levels['coarse']} topics)...")
    topic_model_coarse = topic_model_medium.reduce_topics(documents, nr_topics=suggested_levels['coarse'])
    topics_coarse = topic_model_coarse.topics_
    
    return hierarchical_topics, topics_fine, topics_medium, topics_coarse, suggested_levels

def extract_merge_hierarchy(hierarchical_topics):
    """Extract the actual parent-child relationships from merges"""
    logger.info("\n" + "="*60)
    logger.info("Extracting Merge Hierarchy")
    logger.info("="*60)
    
    df = pd.DataFrame(hierarchical_topics)
    
    # Track which topics were merged at each step
    merge_tree = {}
    topic_to_parent = {}
    
    for _, row in df.iterrows():
        parent_id = row['Parent_ID']
        left_child = row['Child_Left_ID']
        right_child = row['Child_Right_ID']
        distance = row['Distance']
        
        merge_tree[parent_id] = {
            'children': [left_child, right_child],
            'distance': distance
        }
        
        topic_to_parent[left_child] = parent_id
        topic_to_parent[right_child] = parent_id
    
    # Find root topics (those that were never merged)
    all_parents = set(merge_tree.keys())
    all_children = set(topic_to_parent.keys())
    root_topics = all_parents - all_children
    
    logger.info(f"Found {len(root_topics)} root topics in the hierarchy")
    logger.info(f"Total merges: {len(merge_tree)}")
    
    # Show some example merges
    logger.info("\nExample merges (showing first 10):")
    for i, (parent, info) in enumerate(list(merge_tree.items())[:10]):
        logger.info(f"  {info['children'][0]} + {info['children'][1]} → {parent} (distance: {info['distance']:.3f})")
    
    return merge_tree, topic_to_parent

def save_hierarchy_results(topics_fine, topics_medium, topics_coarse, 
                         hierarchical_topics, topic_model, sample_indices):
    """Save the hierarchical clustering results"""
    logger.info("\nSaving hierarchical results...")
    
    # Get topic info at different levels
    topic_keywords = {}
    for topic_id in set(topics_fine):
        if topic_id != -1:
            try:
                words = topic_model.get_topic(topic_id)
                if words and isinstance(words, list):
                    topic_keywords[topic_id] = {
                        'keywords': [word for word, _ in words[:10]],
                        'top_words': ', '.join([word for word, _ in words[:5]])
                    }
                else:
                    topic_keywords[topic_id] = {
                        'keywords': [],
                        'top_words': f'Topic {topic_id}'
                    }
            except:
                topic_keywords[topic_id] = {
                    'keywords': [],
                    'top_words': f'Topic {topic_id}'
                }
    
    # Create a mapping of how topics merge
    df = pd.DataFrame(hierarchical_topics)
    
    # Save comprehensive results
    results = {
        'metadata': {
            'method': 'bertopic_hierarchical_topics',
            'sample_size': len(sample_indices),
            'total_merges': len(hierarchical_topics),
            'hierarchy_levels': {
                'fine': len(set(topics_fine)) - (1 if -1 in topics_fine else 0),
                'medium': len(set(topics_medium)) - (1 if -1 in topics_medium else 0),
                'coarse': len(set(topics_coarse)) - (1 if -1 in topics_coarse else 0)
            }
        },
        'sample_topics': {
            'fine': [int(t) for t in topics_fine[:100]],  # First 100 for inspection
            'medium': [int(t) for t in topics_medium[:100]],
            'coarse': [int(t) for t in topics_coarse[:100]]
        },
        'topic_keywords': topic_keywords,
        'files_generated': {
            'dendrogram': 'bertopic_hierarchy_dendrogram.html',
            'structure': 'bertopic_hierarchy_structure.csv'
        }
    }
    
    output_file = f"bertopic_proper_hierarchy_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    logger.info(f"Results saved to: {output_file}")
    
    # Also create a summary of the hierarchy
    logger.info("\nCreating hierarchy summary...")
    
    # Find which original topics map to which reduced topics
    topic_mappings = {
        'fine_to_medium': {},
        'medium_to_coarse': {}
    }
    
    for i in range(len(topics_fine)):
        fine_topic = topics_fine[i]
        medium_topic = topics_medium[i]
        coarse_topic = topics_coarse[i]
        
        if fine_topic != -1:
            topic_mappings['fine_to_medium'][fine_topic] = medium_topic
        if medium_topic != -1:
            topic_mappings['medium_to_coarse'][medium_topic] = coarse_topic
    
    # Count topics per parent
    medium_children = {}
    for fine, medium in topic_mappings['fine_to_medium'].items():
        if medium not in medium_children:
            medium_children[medium] = []
        medium_children[medium].append(fine)
    
    coarse_children = {}
    for medium, coarse in topic_mappings['medium_to_coarse'].items():
        if coarse not in coarse_children:
            coarse_children[coarse] = []
        coarse_children[coarse].append(medium)
    
    logger.info(f"\nHierarchy statistics:")
    logger.info(f"Average fine topics per medium topic: {np.mean([len(v) for v in medium_children.values()]):.1f}")
    logger.info(f"Average medium topics per coarse topic: {np.mean([len(v) for v in coarse_children.values()]):.1f}")
    
    return output_file

def main():
    """Run proper hierarchical BERTopic analysis on the sample"""
    
    try:
        # Load sample data
        sample_documents, topic_model, sample_indices = load_sample_data()
        
        # Create proper hierarchy
        hierarchical_topics, topics_fine, topics_medium, topics_coarse, levels = create_proper_hierarchy(
            topic_model, sample_documents
        )
        
        # Extract merge relationships
        merge_tree, topic_to_parent = extract_merge_hierarchy(hierarchical_topics)
        
        # Save results
        output_file = save_hierarchy_results(
            topics_fine, topics_medium, topics_coarse,
            hierarchical_topics, topic_model, sample_indices
        )
        
        logger.info("\n" + "="*60)
        logger.info("PROPER HIERARCHY COMPLETE")
        logger.info("="*60)
        logger.info(f"✅ Results saved to: {output_file}")
        logger.info("✅ Dendrogram: bertopic_hierarchy_dendrogram.html")
        logger.info("✅ Structure: bertopic_hierarchy_structure.csv")
        logger.info("\nView the interactive dendrogram by opening the HTML file in a browser")
        logger.info("The dendrogram shows how topics merge based on similarity")
        
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    print("\n" + "="*60)
    print("PROPER BERTopic HIERARCHICAL CLUSTERING (Sample-Based)")
    print("="*60)
    print("\nThis script uses BERTopic's hierarchical_topics() method on the")
    print("30K sample that was used to train the model. It creates a proper")
    print("dendrogram showing how topics merge based on similarity.")
    print("="*60 + "\n")
    
    main()