#!/usr/bin/env python3
"""
True Hierarchical BERTopic Implementation
Creates proper 3-level hierarchy by running BERTopic with different granularities
"""

import os
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from umap import UMAP
from hdbscan import HDBSCAN
import pickle
import json
import logging
from datetime import datetime
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_saved_data():
    """Load the saved data"""
    logger.info("Loading saved data...")
    
    with open('bertopic_embeddings.pkl', 'rb') as f:
        embeddings = pickle.load(f)
    
    if not isinstance(embeddings, np.ndarray):
        embeddings = np.array(embeddings)
        
    with open('bertopic_documents.pkl', 'rb') as f:
        documents = pickle.load(f)
    
    video_files = [f for f in os.listdir('.') if f.startswith('bertopic_valid_videos_') and f.endswith('.pkl')]
    if video_files:
        with open(video_files[0], 'rb') as f:
            video_data = pickle.load(f)
    else:
        with open('bertopic_video_data.pkl', 'rb') as f:
            video_data = pickle.load(f)[:len(embeddings)]
    
    logger.info(f"Loaded {len(embeddings):,} embeddings")
    return embeddings, documents, video_data

def run_bertopic_level(embeddings, documents, min_cluster_size, n_topics_target, level_name):
    """Run BERTopic for a specific hierarchy level"""
    logger.info(f"\n{'='*60}")
    logger.info(f"Creating {level_name} (target: ~{n_topics_target} topics)")
    logger.info(f"{'='*60}")
    
    # UMAP for dimensionality reduction
    umap_model = UMAP(
        n_neighbors=15,
        n_components=5,
        metric='cosine',
        random_state=42,
        verbose=True
    )
    
    # HDBSCAN for clustering with appropriate min_cluster_size
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=5,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True
    )
    
    # Vectorizer for c-TF-IDF
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=10,
        max_df=0.95,
        ngram_range=(1, 2),
        max_features=10000
    )
    
    # Create BERTopic model
    topic_model = BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        calculate_probabilities=False,
        verbose=True
    )
    
    # Fit the model
    start_time = datetime.now()
    topics, _ = topic_model.fit_transform(documents, embeddings)
    elapsed = (datetime.now() - start_time).total_seconds()
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude outlier topic -1
    outliers = np.sum(topics == -1)
    
    logger.info(f"\n✅ {level_name} completed in {elapsed/60:.1f} minutes")
    logger.info(f"Topics created: {n_topics} (target was ~{n_topics_target})")
    logger.info(f"Outliers: {outliers:,} ({outliers/len(topics)*100:.1f}%)")
    
    # Get topic keywords for each topic
    topic_keywords = {}
    for topic_id in topic_info['Topic']:
        if topic_id != -1:
            keywords = topic_model.get_topic(topic_id)
            topic_keywords[topic_id] = [word for word, score in keywords[:10]]
    
    return topics, topic_model, topic_keywords, topic_info

def create_topic_mappings(topics_l1, topics_l2, topics_l3, documents):
    """Create mappings between hierarchy levels based on document overlap"""
    logger.info("\nCreating hierarchy mappings...")
    
    # Create document-to-topic mappings for each level
    doc_topics = {
        'l1': topics_l1,
        'l2': topics_l2,
        'l3': topics_l3
    }
    
    # Map L3 topics to L2 topics based on document overlap
    l3_to_l2 = {}
    for l3_topic in np.unique(topics_l3):
        if l3_topic == -1:
            continue
        # Find which L2 topic most L3 documents belong to
        l3_docs = np.where(topics_l3 == l3_topic)[0]
        l2_topics_for_l3 = topics_l2[l3_docs]
        l2_topics_for_l3 = l2_topics_for_l3[l2_topics_for_l3 != -1]  # Exclude outliers
        if len(l2_topics_for_l3) > 0:
            most_common_l2 = np.bincount(l2_topics_for_l3).argmax()
            l3_to_l2[l3_topic] = most_common_l2
    
    # Map L2 topics to L1 topics
    l2_to_l1 = {}
    for l2_topic in np.unique(topics_l2):
        if l2_topic == -1:
            continue
        l2_docs = np.where(topics_l2 == l2_topic)[0]
        l1_topics_for_l2 = topics_l1[l2_docs]
        l1_topics_for_l2 = l1_topics_for_l2[l1_topics_for_l2 != -1]
        if len(l1_topics_for_l2) > 0:
            most_common_l1 = np.bincount(l1_topics_for_l2).argmax()
            l2_to_l1[l2_topic] = most_common_l1
    
    return l3_to_l2, l2_to_l1

def save_hierarchical_results(video_data, topics_l1, topics_l2, topics_l3, 
                            keywords_l1, keywords_l2, keywords_l3,
                            l3_to_l2, l2_to_l1, 
                            info_l1, info_l2, info_l3):
    """Save results with proper hierarchy"""
    
    results = []
    
    for i in range(len(video_data)):
        video = video_data[i] if i < len(video_data) else {'id': f'unknown_{i}'}
        
        # Get topics at each level
        l3_topic = topics_l3[i]
        l2_topic = topics_l2[i] 
        l1_topic = topics_l1[i]
        
        # Use mappings to ensure consistency
        if l3_topic != -1 and l3_topic in l3_to_l2:
            mapped_l2 = l3_to_l2[l3_topic]
            if mapped_l2 in l2_to_l1:
                mapped_l1 = l2_to_l1[mapped_l2]
            else:
                mapped_l1 = l1_topic
        else:
            mapped_l2 = l2_topic
            mapped_l1 = l1_topic
        
        results.append({
            'id': video.get('id', f'unknown_{i}'),
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'topic_level_1': int(mapped_l1),
            'topic_level_2': int(mapped_l2),
            'topic_level_3': int(l3_topic),
            'topic_confidence': 0.8
        })
    
    # Create topic hierarchy info
    hierarchy_info = {
        'level_1': {
            'topics': {str(tid): {
                'keywords': keywords_l1.get(tid, []),
                'size': int(info_l1[info_l1['Topic'] == tid]['Count'].values[0]) if tid != -1 else 0
            } for tid in keywords_l1.keys()}
        },
        'level_2': {
            'topics': {str(tid): {
                'keywords': keywords_l2.get(tid, []),
                'size': int(info_l2[info_l2['Topic'] == tid]['Count'].values[0]) if tid != -1 else 0,
                'parent_l1': l2_to_l1.get(tid, -1)
            } for tid in keywords_l2.keys()}
        },
        'level_3': {
            'topics': {str(tid): {
                'keywords': keywords_l3.get(tid, []),
                'size': int(info_l3[info_l3['Topic'] == tid]['Count'].values[0]) if tid != -1 else 0,
                'parent_l2': l3_to_l2.get(tid, -1)
            } for tid in keywords_l3.keys()}
        }
    }
    
    output_file = f"bertopic_true_hierarchy_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': {
                'total_videos': len(results),
                'hierarchy_levels': {
                    'level_1': len(keywords_l1),
                    'level_2': len(keywords_l2),
                    'level_3': len(keywords_l3)
                },
                'method': 'true_hierarchical_clustering'
            },
            'hierarchy_info': hierarchy_info,
            'classifications': results
        }, f, indent=2)
    
    logger.info(f"\n✅ Results saved to: {output_file}")
    logger.info(f"To generate LLM names: python generate-topic-names-with-llm.py {output_file}")
    
    return output_file

def main():
    """Run true hierarchical BERTopic"""
    embeddings, documents, video_data = load_saved_data()
    
    # Level 1: Super Categories (15-20 topics)
    topics_l1, model_l1, keywords_l1, info_l1 = run_bertopic_level(
        embeddings, documents, 
        min_cluster_size=5000,  # Large clusters for broad categories
        n_topics_target=15,
        level_name="Level 1 - Super Categories"
    )
    
    # Level 2: Main Categories (40-50 topics)
    topics_l2, model_l2, keywords_l2, info_l2 = run_bertopic_level(
        embeddings, documents,
        min_cluster_size=2000,  # Medium clusters
        n_topics_target=40,
        level_name="Level 2 - Main Categories"
    )
    
    # Level 3: Sub Categories (100-150 topics)
    topics_l3, model_l3, keywords_l3, info_l3 = run_bertopic_level(
        embeddings, documents,
        min_cluster_size=500,   # Smaller clusters for specific topics
        n_topics_target=130,
        level_name="Level 3 - Sub Categories"
    )
    
    # Create mappings between levels
    l3_to_l2, l2_to_l1 = create_topic_mappings(topics_l1, topics_l2, topics_l3, documents)
    
    # Save results
    output_file = save_hierarchical_results(
        video_data, topics_l1, topics_l2, topics_l3,
        keywords_l1, keywords_l2, keywords_l3,
        l3_to_l2, l2_to_l1,
        info_l1, info_l2, info_l3
    )
    
    # Print hierarchy statistics
    logger.info("\n" + "="*60)
    logger.info("HIERARCHY STATISTICS")
    logger.info("="*60)
    
    # Show mapping coverage
    l3_mapped = len(l3_to_l2)
    l2_mapped = len(l2_to_l1)
    logger.info(f"L3→L2 mappings: {l3_mapped} topics mapped")
    logger.info(f"L2→L1 mappings: {l2_mapped} topics mapped")
    
    # Show example hierarchy
    logger.info("\nExample Topic Hierarchy:")
    for l1_id in list(l2_to_l1.values())[:3]:
        logger.info(f"\nL1 Topic {l1_id}: {' '.join(keywords_l1.get(l1_id, [])[:3])}")
        # Find L2 topics under this L1
        l2_children = [l2 for l2, parent in l2_to_l1.items() if parent == l1_id][:3]
        for l2_id in l2_children:
            logger.info(f"  └─ L2 Topic {l2_id}: {' '.join(keywords_l2.get(l2_id, [])[:3])}")
            # Find L3 topics under this L2
            l3_children = [l3 for l3, parent in l3_to_l2.items() if parent == l2_id][:2]
            for l3_id in l3_children:
                logger.info(f"      └─ L3 Topic {l3_id}: {' '.join(keywords_l3.get(l3_id, [])[:3])}")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("TRUE HIERARCHICAL BERTopic")
    print("="*60)
    print("\nThis creates a proper 3-level topic hierarchy by:")
    print("1. Running BERTopic 3 times with different granularities")
    print("2. Creating parent-child mappings based on document overlap")
    print("3. Ensuring consistent hierarchical relationships")
    print("="*60 + "\n")
    
    main()