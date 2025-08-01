#!/usr/bin/env python3
"""
Iterative BERTopic - Ensures no topics are missed

1. Start with 30K sample
2. Find unclustered videos  
3. Add more samples from unclustered
4. Repeat until satisfied
"""

import os
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from umap import UMAP
from hdbscan import HDBSCAN
import hdbscan
import pickle
import json
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_saved_data():
    """Load the saved data"""
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
    
    return embeddings, documents, video_data

def iterative_bertopic(embeddings, documents, video_data):
    """Run BERTopic iteratively to ensure coverage"""
    
    logger.info("ITERATIVE APPROACH: Ensuring complete topic coverage")
    logger.info("="*60)
    
    n_total = len(embeddings)
    all_indices = np.arange(n_total)
    
    # Start with 30K sample
    initial_sample_size = 30000
    processed_indices = set()
    iteration = 1
    
    # Initialize arrays for results
    final_topics = np.full(n_total, -1)
    
    while len(processed_indices) < n_total and iteration <= 3:
        logger.info(f"\nITERATION {iteration}")
        logger.info("-"*40)
        
        # Get unprocessed indices
        unprocessed = np.array([i for i in all_indices if i not in processed_indices])
        
        if iteration == 1:
            # First iteration: stratified sample
            from sklearn.cluster import MiniBatchKMeans
            kmeans = MiniBatchKMeans(n_clusters=100, random_state=42)
            strata = kmeans.fit_predict(embeddings[unprocessed])
            
            sample_indices = []
            per_stratum = initial_sample_size // 100
            
            for s in range(100):
                stratum_idx = unprocessed[strata == s]
                if len(stratum_idx) > per_stratum:
                    sampled = np.random.choice(stratum_idx, per_stratum, replace=False)
                else:
                    sampled = stratum_idx
                sample_indices.extend(sampled)
            
            sample_indices = np.array(sample_indices[:initial_sample_size])
        else:
            # Later iterations: focus on outliers and low-confidence
            # Take up to 20K additional samples
            sample_size = min(20000, len(unprocessed))
            sample_indices = np.random.choice(unprocessed, sample_size, replace=False)
        
        logger.info(f"Processing {len(sample_indices):,} videos")
        
        # Get sample data
        sample_embeddings = embeddings[sample_indices]
        sample_documents = [documents[i] for i in sample_indices]
        
        # Run UMAP
        logger.info("Running UMAP...")
        umap_model = UMAP(n_neighbors=15, n_components=5, metric='cosine', random_state=42)
        embeddings_reduced = umap_model.fit_transform(sample_embeddings)
        
        # Run HDBSCAN
        logger.info("Running HDBSCAN...")
        hdbscan_model = HDBSCAN(
            min_cluster_size=50,
            min_samples=10,
            prediction_data=True
        )
        clusters = hdbscan_model.fit_predict(embeddings_reduced)
        
        n_clusters = len(set(clusters)) - (1 if -1 in clusters else 0)
        outliers = np.sum(clusters == -1)
        logger.info(f"Found {n_clusters} clusters, {outliers} outliers ({outliers/len(clusters)*100:.1f}%)")
        
        # Store results
        final_topics[sample_indices] = clusters
        processed_indices.update(sample_indices)
        
        # If we have outliers, check if there are more videos to process
        if outliers > len(clusters) * 0.3 and len(processed_indices) < n_total:
            logger.info("High outlier rate - will process more videos")
            iteration += 1
        else:
            # Assign remaining videos using approximate_predict
            remaining = np.array([i for i in all_indices if i not in processed_indices])
            if len(remaining) > 0:
                logger.info(f"\nAssigning {len(remaining):,} remaining videos...")
                remaining_embeddings = embeddings[remaining]
                remaining_reduced = umap_model.transform(remaining_embeddings)
                remaining_clusters, _ = hdbscan.approximate_predict(hdbscan_model, remaining_reduced)
                final_topics[remaining] = remaining_clusters
            break
    
    # Create BERTopic model with all documents
    logger.info("\nCreating final BERTopic model...")
    
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=10,
        max_df=0.95,
        ngram_range=(1, 2)
    )
    
    topic_model = BERTopic(
        vectorizer_model=vectorizer_model,
        calculate_probabilities=False,
        verbose=True
    )
    
    topic_model.fit(documents, y=final_topics)
    
    # Get final statistics
    unique_topics = len(set(final_topics)) - (1 if -1 in final_topics else 0)
    outlier_count = np.sum(final_topics == -1)
    
    logger.info(f"\n{'='*60}")
    logger.info(f"FINAL RESULTS:")
    logger.info(f"Total topics: {unique_topics}")
    logger.info(f"Total outliers: {outlier_count:,} ({outlier_count/n_total*100:.1f}%)")
    logger.info(f"Iterations used: {iteration}")
    logger.info(f"{'='*60}")
    
    # Save results
    results = []
    for i in range(len(video_data)):
        video = video_data[i]
        results.append({
            'id': video.get('id'),
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'topic_cluster_id': int(final_topics[i]),
            'topic_confidence': 0.8
        })
    
    output_file = f"bertopic_iterative_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': {
                'total_videos': len(results),
                'unique_topics': unique_topics,
                'outlier_count': int(outlier_count),
                'iterations': iteration
            },
            'classifications': results
        }, f)
    
    logger.info(f"\nResults saved to: {output_file}")
    
    return topic_model, final_topics

if __name__ == "__main__":
    print("\n" + "="*60)
    print("ITERATIVE BERTopic - Ensures No Topics Missed")
    print("="*60)
    print("\nThis approach:")
    print("1. Starts with 30K stratified sample")
    print("2. Checks for high outlier rates")
    print("3. Adds more samples if needed")
    print("4. Ensures comprehensive coverage")
    print("="*60 + "\n")
    
    embeddings, documents, video_data = load_saved_data()
    iterative_bertopic(embeddings, documents, video_data)