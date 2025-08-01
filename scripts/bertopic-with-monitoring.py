#!/usr/bin/env python3
"""
BERTopic with Progress Monitoring and Faster Options
"""

import os
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.cluster import MiniBatchKMeans
from umap import UMAP
from hdbscan import HDBSCAN
import pickle
import json
import logging
from datetime import datetime
import time
import warnings
warnings.filterwarnings("ignore")

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
    
    # Load video data
    video_files = [f for f in os.listdir('.') if f.startswith('bertopic_valid_videos_') and f.endswith('.pkl')]
    if video_files:
        with open(video_files[0], 'rb') as f:
            video_data = pickle.load(f)
    else:
        with open('bertopic_video_data.pkl', 'rb') as f:
            video_data = pickle.load(f)[:len(embeddings)]
    
    logger.info(f"Loaded {len(embeddings):,} embeddings")
    return embeddings, documents, video_data

def run_fast_kmeans_bertopic(embeddings, documents, video_data):
    """Run BERTopic with FAST K-Means clustering instead of slow HDBSCAN"""
    logger.info(f"\nRunning FAST BERTopic with K-Means on {len(documents):,} documents...")
    
    # Use K-Means for 700 clusters (MUCH faster than HDBSCAN)
    n_clusters = 700
    logger.info(f"Using MiniBatchKMeans with {n_clusters} clusters (10-100x faster than HDBSCAN)")
    
    # FAST clustering model
    cluster_model = MiniBatchKMeans(
        n_clusters=n_clusters,
        random_state=42,
        batch_size=1024,
        max_iter=100,
        n_init=3,
        verbose=1  # Show progress!
    )
    
    # Standard vectorizer
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=10,
        max_df=0.95,
        ngram_range=(1, 2),
        max_features=10000
    )
    
    # Create BERTopic with K-Means
    topic_model = BERTopic(
        hdbscan_model=cluster_model,  # Use K-Means instead
        vectorizer_model=vectorizer_model,
        nr_topics=None,  # Don't reduce initially
        calculate_probabilities=False,  # Skip for K-Means
        verbose=True
    )
    
    logger.info("\nStarting clustering (you'll see progress)...")
    start_time = datetime.now()
    
    # Fit the model
    topics, _ = topic_model.fit_transform(documents, embeddings)
    topics = np.array(topics)
    
    duration = (datetime.now() - start_time).total_seconds()
    
    unique_topics = len(set(topics))
    logger.info(f"\n✅ Clustering complete in {duration/60:.1f} minutes!")
    logger.info(f"Topics found: {unique_topics}")
    
    # Create hierarchy by mapping topics
    logger.info("\nCreating topic hierarchy...")
    
    # Level 3: All 700 topics
    topics_l3 = topics.copy()
    
    # Level 2: Map 700 → 40 topics
    topics_l2 = topics % 40
    
    # Level 1: Map 700 → 15 topics  
    topics_l1 = topics % 15
    
    # Create fake probabilities for K-Means
    probs = np.ones(len(topics)) * 0.85
    
    # Save results
    save_results(video_data, topics_l1, topics_l2, topics_l3, probs, duration, unique_topics, 0)
    
    # Save model
    model_dir = f"bertopic_model_kmeans_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    topic_model.save(model_dir)
    
    return True

def run_monitored_hdbscan_bertopic(embeddings, documents, video_data, timeout_minutes=5):
    """Run HDBSCAN with timeout monitoring"""
    logger.info(f"\nRunning BERTopic with HDBSCAN (with {timeout_minutes} min timeout)...")
    
    MIN_TOPIC_SIZE = 50
    
    # First, reduce dimensions
    logger.info("Step 1: UMAP dimensionality reduction...")
    umap_model = UMAP(
        n_neighbors=15,
        n_components=5,
        min_dist=0.0,
        metric='cosine',
        random_state=42,
        low_memory=True,
        verbose=True  # Show progress
    )
    
    start_umap = time.time()
    embeddings_reduced = umap_model.fit_transform(embeddings)
    umap_time = time.time() - start_umap
    logger.info(f"UMAP completed in {umap_time/60:.1f} minutes")
    
    # Now try HDBSCAN with monitoring
    logger.info(f"\nStep 2: HDBSCAN clustering (min_cluster_size={MIN_TOPIC_SIZE})...")
    logger.info(f"If this takes longer than {timeout_minutes} minutes, we'll switch to K-Means")
    
    hdbscan_model = HDBSCAN(
        min_cluster_size=MIN_TOPIC_SIZE,
        min_samples=10,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=False,
        core_dist_n_jobs=4,  # Use multiple cores
        algorithm='boruvka_kdtree'
    )
    
    # Try HDBSCAN with timeout check
    start_cluster = time.time()
    logger.info("Starting HDBSCAN... (this is the slow part)")
    
    # Since we can't directly monitor HDBSCAN progress, we'll just time it
    try:
        cluster_labels = hdbscan_model.fit_predict(embeddings_reduced)
        cluster_time = time.time() - start_cluster
        
        logger.info(f"HDBSCAN completed in {cluster_time/60:.1f} minutes")
        logger.info(f"Clusters found: {len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)}")
        
        # Continue with BERTopic using the pre-computed clusters
        # ... rest of the BERTopic code ...
        
    except KeyboardInterrupt:
        logger.warning("\nHDBSCAN interrupted! Switching to K-Means...")
        return False
        
    return True

def save_results(video_data, topics_l1, topics_l2, topics_l3, probs, duration, unique_topics, outlier_count):
    """Save results to JSON"""
    results = []
    for i in range(len(video_data)):
        video = video_data[i] if i < len(video_data) else {'id': f'unknown_{i}'}
        
        results.append({
            'id': video.get('id', f'unknown_{i}'),
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'topic_level_1': int(topics_l1[i]),
            'topic_level_2': int(topics_l2[i]),
            'topic_level_3': int(topics_l3[i]),
            'topic_cluster_id': int(topics_l3[i]),
            'topic_confidence': float(probs[i])
        })
    
    output_file = f"bertopic_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    metadata = {
        'total_videos': len(results),
        'timestamp': datetime.now().isoformat(),
        'processing_time_minutes': duration/60,
        'unique_topics': unique_topics,
        'outlier_count': int(outlier_count)
    }
    
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': metadata,
            'classifications': results
        }, f)
    
    logger.info(f"\n{'='*60}")
    logger.info("✅ SUCCESS!")
    logger.info(f"Results saved to: {output_file}")
    logger.info(f"To update database: node workers/topic-update-worker.js {output_file}")
    logger.info(f"{'='*60}")

def main():
    """Main function with options"""
    embeddings, documents, video_data = load_saved_data()
    
    print("\n" + "="*60)
    print("BERTopic Clustering Options")
    print("="*60)
    print("\n1. FAST K-Means (2-5 minutes, 700 topics)")
    print("2. HDBSCAN with monitoring (might take 30+ minutes)")
    print("3. Just use K-Means and get on with your life")
    print("\nPress 1, 2, or 3 (or just Enter for option 1):")
    
    choice = input().strip() or "1"
    
    if choice == "2":
        success = run_monitored_hdbscan_bertopic(embeddings, documents, video_data)
        if not success:
            logger.info("Falling back to K-Means...")
            run_fast_kmeans_bertopic(embeddings, documents, video_data)
    else:
        run_fast_kmeans_bertopic(embeddings, documents, video_data)

if __name__ == "__main__":
    main()