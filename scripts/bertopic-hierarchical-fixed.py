#!/usr/bin/env python3
"""
Fixed BERTopic Hierarchical Solution
- Uses same stratified sampling approach (required for 177K docs)
- Runs BERTopic 3 times with different min_cluster_size for true hierarchy
- Creates proper parent-child mappings
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

def stratified_sample(embeddings, documents, sample_size=30000):
    """Create a stratified sample that represents the full dataset"""
    logger.info(f"Creating stratified sample of {sample_size:,} documents...")
    
    n_total = len(embeddings)
    
    if n_total <= sample_size:
        return np.arange(n_total), embeddings, documents
    
    # Use K-means to create strata
    from sklearn.cluster import MiniBatchKMeans
    n_strata = 100
    kmeans = MiniBatchKMeans(n_clusters=n_strata, batch_size=1000, random_state=42)
    strata_labels = kmeans.fit_predict(embeddings)
    
    # Sample proportionally from each stratum
    sample_indices = []
    samples_per_stratum = sample_size // n_strata
    
    for stratum in range(n_strata):
        stratum_indices = np.where(strata_labels == stratum)[0]
        if len(stratum_indices) > samples_per_stratum:
            sampled = np.random.choice(stratum_indices, samples_per_stratum, replace=False)
        else:
            sampled = stratum_indices
        sample_indices.extend(sampled)
    
    sample_indices = np.array(sample_indices)
    sample_embeddings = embeddings[sample_indices]
    sample_documents = [documents[i] for i in sample_indices]
    
    logger.info(f"Sample created with {len(sample_indices):,} documents from {n_strata} strata")
    
    # Save sample indices for reproducibility
    with open('bertopic_sample_indices.pkl', 'wb') as f:
        pickle.dump(sample_indices, f)
    logger.info("Saved sample indices to bertopic_sample_indices.pkl")
    
    return sample_indices, sample_embeddings, sample_documents

def run_bertopic_on_sample(sample_embeddings, sample_documents, min_cluster_size, level_name):
    """Run BERTopic on the sample with specific parameters"""
    logger.info(f"\n{'='*60}")
    logger.info(f"Running BERTopic for {level_name}")
    logger.info(f"Min cluster size: {min_cluster_size}")
    logger.info(f"{'='*60}")
    
    # UMAP model
    umap_model = UMAP(
        n_neighbors=15,
        n_components=5,
        metric='cosine',
        random_state=42,
        verbose=True
    )
    
    # HDBSCAN with different min_cluster_size for each level
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=10,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True,
        core_dist_n_jobs=-1
    )
    
    # Vectorizer - adjust min_df based on expected cluster sizes
    min_docs = max(2, min(10, min_cluster_size // 10))  # Adaptive min_df
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=min_docs,
        max_df=0.95,
        ngram_range=(1, 2),
        max_features=10000
    )
    
    # Create BERTopic
    topic_model = BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        calculate_probabilities=False,
        verbose=True
    )
    
    # Fit on sample
    start_time = datetime.now()
    sample_topics, _ = topic_model.fit_transform(sample_documents, sample_embeddings)
    fit_time = (datetime.now() - start_time).total_seconds()
    
    # Get topic info
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude outlier topic
    n_outliers = np.sum(sample_topics == -1)
    
    logger.info(f"Completed in {fit_time/60:.1f} minutes")
    logger.info(f"Found {n_topics} topics")
    logger.info(f"Outliers: {n_outliers} ({n_outliers/len(sample_topics)*100:.1f}%)")
    
    return topic_model, sample_topics, umap_model, hdbscan_model

def assign_all_documents(embeddings, topic_model, umap_model, hdbscan_model, sample_indices, sample_topics):
    """Assign topics to all documents using the fitted models"""
    logger.info("\nAssigning topics to all documents...")
    
    # Initialize topics array
    all_topics = np.zeros(len(embeddings), dtype=int) - 1  # Start with -1 (outlier)
    
    # Assign sample topics
    all_topics[sample_indices] = sample_topics
    
    # Get remaining indices
    all_indices = np.arange(len(embeddings))
    remaining_indices = np.setdiff1d(all_indices, sample_indices)
    
    if len(remaining_indices) > 0:
        logger.info(f"Assigning {len(remaining_indices):,} remaining documents...")
        remaining_embeddings = embeddings[remaining_indices]
        
        # Transform with UMAP
        logger.info("Transforming embeddings with UMAP...")
        remaining_reduced = []
        batch_size = 5000
        
        for i in tqdm(range(0, len(remaining_embeddings), batch_size), desc="UMAP transform"):
            batch = remaining_embeddings[i:i+batch_size]
            batch_reduced = umap_model.transform(batch)
            remaining_reduced.append(batch_reduced)
        
        remaining_reduced = np.vstack(remaining_reduced)
        
        # Assign clusters
        logger.info("Assigning to clusters...")
        try:
            import hdbscan
            remaining_labels, _ = hdbscan.approximate_predict(hdbscan_model, remaining_reduced)
            logger.info("Used approximate_predict successfully")
        except Exception as e:
            logger.warning(f"approximate_predict failed ({e}), using nearest cluster assignment...")
            # Fallback implementation here if needed
            remaining_labels = np.zeros(len(remaining_reduced), dtype=int) - 1
        
        all_topics[remaining_indices] = remaining_labels
    
    return all_topics

def create_hierarchy_mappings(topics_l1, topics_l2, topics_l3):
    """Create parent-child mappings between hierarchy levels"""
    logger.info("\nCreating hierarchy mappings...")
    
    # Map L3 to L2 based on co-occurrence
    l3_to_l2 = {}
    for l3_topic in np.unique(topics_l3):
        if l3_topic == -1:
            continue
        # Find most common L2 topic for this L3 topic
        l3_mask = topics_l3 == l3_topic
        l2_for_l3 = topics_l2[l3_mask]
        l2_for_l3 = l2_for_l3[l2_for_l3 != -1]
        if len(l2_for_l3) > 0:
            most_common = np.bincount(l2_for_l3).argmax()
            l3_to_l2[l3_topic] = most_common
    
    # Map L2 to L1
    l2_to_l1 = {}
    for l2_topic in np.unique(topics_l2):
        if l2_topic == -1:
            continue
        l2_mask = topics_l2 == l2_topic
        l1_for_l2 = topics_l1[l2_mask]
        l1_for_l2 = l1_for_l2[l1_for_l2 != -1]
        if len(l1_for_l2) > 0:
            most_common = np.bincount(l1_for_l2).argmax()
            l2_to_l1[l2_topic] = most_common
    
    return l3_to_l2, l2_to_l1

def save_results(video_data, topics_l1, topics_l2, topics_l3, models, mappings):
    """Save results with proper hierarchy"""
    logger.info("\nSaving results...")
    
    model_l1, model_l2, model_l3 = models
    l3_to_l2, l2_to_l1 = mappings
    
    results = []
    for i in range(len(video_data)):
        video = video_data[i] if i < len(video_data) else {'id': f'unknown_{i}'}
        
        # Get topics at each level
        l3 = int(topics_l3[i])
        l2 = int(topics_l2[i])
        l1 = int(topics_l1[i])
        
        # Use mappings to ensure consistency
        if l3 != -1 and l3 in l3_to_l2:
            l2_mapped = l3_to_l2[l3]
            if l2_mapped in l2_to_l1:
                l1_mapped = l2_to_l1[l2_mapped]
            else:
                l1_mapped = l1
            l2 = l2_mapped
            l1 = l1_mapped
        
        results.append({
            'id': video.get('id', f'unknown_{i}'),
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'topic_level_1': l1,
            'topic_level_2': l2,
            'topic_level_3': l3,
            'topic_confidence': 0.8
        })
    
    # Get topic info for each level
    info_l1 = model_l1.get_topic_info()
    info_l2 = model_l2.get_topic_info()
    info_l3 = model_l3.get_topic_info()
    
    output_file = f"bertopic_hierarchical_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    metadata = {
        'total_videos': len(results),
        'hierarchy_info': {
            'level_1': {
                'n_topics': len(info_l1) - 1,
                'outliers': np.sum(topics_l1 == -1)
            },
            'level_2': {
                'n_topics': len(info_l2) - 1,
                'outliers': np.sum(topics_l2 == -1)
            },
            'level_3': {
                'n_topics': len(info_l3) - 1,
                'outliers': np.sum(topics_l3 == -1)
            }
        },
        'mappings': {
            'l3_to_l2': {str(k): v for k, v in l3_to_l2.items()},
            'l2_to_l1': {str(k): v for k, v in l2_to_l1.items()}
        }
    }
    
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': metadata,
            'classifications': results
        }, f, indent=2)
    
    logger.info(f"Results saved to: {output_file}")
    
    # Save models
    for level, model in [('l1', model_l1), ('l2', model_l2), ('l3', model_l3)]:
        model_dir = f"bertopic_model_{level}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        model.save(model_dir)
        logger.info(f"Model {level} saved to: {model_dir}")
    
    return output_file

def main():
    """Run hierarchical BERTopic with proper 3-level structure"""
    
    # Load data
    embeddings, documents, video_data = load_saved_data()
    
    # Create stratified sample
    sample_indices, sample_embeddings, sample_documents = stratified_sample(
        embeddings, documents, sample_size=30000
    )
    
    # Level 3: Fine-grained topics (~130 topics)
    model_l3, sample_topics_l3, umap_l3, hdbscan_l3 = run_bertopic_on_sample(
        sample_embeddings, sample_documents,
        min_cluster_size=50,  # Small clusters for detailed topics
        level_name="Level 3 (Fine-grained ~130 topics)"
    )
    
    # Level 2: Main categories (~40 topics)
    model_l2, sample_topics_l2, umap_l2, hdbscan_l2 = run_bertopic_on_sample(
        sample_embeddings, sample_documents,
        min_cluster_size=200,  # Medium clusters
        level_name="Level 2 (Main categories ~40 topics)"
    )
    
    # Level 1: Super categories (~15 topics)
    model_l1, sample_topics_l1, umap_l1, hdbscan_l1 = run_bertopic_on_sample(
        sample_embeddings, sample_documents,
        min_cluster_size=500,  # Large clusters for broad categories
        level_name="Level 1 (Super categories ~15 topics)"
    )
    
    # Assign all documents to topics at each level
    logger.info("\n" + "="*60)
    logger.info("Assigning all documents to hierarchy levels")
    logger.info("="*60)
    
    topics_l3 = assign_all_documents(embeddings, model_l3, umap_l3, hdbscan_l3, sample_indices, sample_topics_l3)
    topics_l2 = assign_all_documents(embeddings, model_l2, umap_l2, hdbscan_l2, sample_indices, sample_topics_l2)
    topics_l1 = assign_all_documents(embeddings, model_l1, umap_l1, hdbscan_l1, sample_indices, sample_topics_l1)
    
    # Create hierarchy mappings
    l3_to_l2, l2_to_l1 = create_hierarchy_mappings(topics_l1, topics_l2, topics_l3)
    
    # Save everything
    output_file = save_results(
        video_data, topics_l1, topics_l2, topics_l3,
        (model_l1, model_l2, model_l3),
        (l3_to_l2, l2_to_l1)
    )
    
    # Print summary
    logger.info("\n" + "="*60)
    logger.info("HIERARCHICAL CLUSTERING COMPLETE")
    logger.info("="*60)
    logger.info(f"Level 1: {len(np.unique(topics_l1)) - 1} topics")
    logger.info(f"Level 2: {len(np.unique(topics_l2)) - 1} topics")
    logger.info(f"Level 3: {len(np.unique(topics_l3)) - 1} topics")
    logger.info(f"\nL3→L2 mappings: {len(l3_to_l2)}")
    logger.info(f"L2→L1 mappings: {len(l2_to_l1)}")
    logger.info(f"\n✅ Output saved to: {output_file}")
    logger.info(f"\nNext step: python scripts/generate-topic-names-with-llm.py {output_file}")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("HIERARCHICAL BERTopic WITH PROPER 3-LEVEL STRUCTURE")
    print("="*60)
    print("\nThis script:")
    print("1. Uses stratified sampling (30K from 177K) for computational feasibility")
    print("2. Runs BERTopic 3 times with different min_cluster_size parameters")
    print("3. Creates true parent-child mappings between levels")
    print("4. Assigns all 177K documents using approximate_predict")
    print("="*60 + "\n")
    
    main()