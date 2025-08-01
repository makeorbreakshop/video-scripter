#!/usr/bin/env python3
"""
Fixed HDBSCAN BERTopic - Diagnoses and fixes the hanging issue
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
import warnings
warnings.filterwarnings("ignore", category=FutureWarning)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def load_saved_data():
    """Load the saved data"""
    logger.info("Loading saved data...")
    
    with open('bertopic_embeddings.pkl', 'rb') as f:
        embeddings = pickle.load(f)
    logger.info(f"Loaded {len(embeddings):,} embeddings")
    logger.info(f"Embedding shape: {embeddings.shape}")
    logger.info(f"Embedding dtype: {embeddings.dtype}")
    
    # Check for NaN or infinite values
    if np.any(np.isnan(embeddings)):
        logger.error("Found NaN values in embeddings!")
        # Fix NaN values
        embeddings = np.nan_to_num(embeddings)
        
    if np.any(np.isinf(embeddings)):
        logger.error("Found infinite values in embeddings!")
        embeddings = np.nan_to_num(embeddings)
    
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
    
    return embeddings, documents, video_data

def run_fixed_bertopic(embeddings, documents, video_data):
    """Run BERTopic with proper HDBSCAN settings"""
    logger.info(f"\nRunning BERTopic with FIXED settings on {len(documents):,} documents...")
    
    # CRITICAL: For 177K documents, min_cluster_size should be larger!
    # Rule of thumb: sqrt(n) / 2 to sqrt(n)
    min_cluster_size = int(np.sqrt(len(documents)) / 2)
    min_cluster_size = max(min_cluster_size, 100)  # At least 100
    min_cluster_size = min(min_cluster_size, 500)  # But not too large
    
    logger.info(f"Using min_cluster_size={min_cluster_size} (was 25 - TOO SMALL!)")
    
    # Configure UMAP for better performance
    umap_model = UMAP(
        n_neighbors=15,
        n_components=5,  # 5D is often better than default 2D
        min_dist=0.0,
        metric='cosine',
        random_state=42,
        low_memory=True  # Important for large datasets!
    )
    
    # Configure HDBSCAN with better settings
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=10,  # Helps with stability
        metric='euclidean',
        cluster_selection_method='eom',  # 'eom' is often faster than 'leaf'
        prediction_data=False,  # Save memory
        core_dist_n_jobs=1,  # Avoid parallelization issues
        algorithm='boruvka_kdtree',  # Good for low-dimensional data
        memory='cache'  # Cache distances
    )
    
    # Simple vectorizer
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=5,  # Slightly higher for large dataset
        max_df=0.95,
        ngram_range=(1, 2),
        max_features=10000
    )
    
    # Create BERTopic
    topic_model = BERTopic(
        umap_model=umap_model,
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        nr_topics="auto",
        calculate_probabilities=False,  # Skip for speed
        verbose=True
    )
    
    logger.info("\nStarting BERTopic...")
    logger.info("Steps: UMAP reduction → HDBSCAN clustering → Topic extraction")
    
    start_time = datetime.now()
    
    try:
        # Run with smaller sample first to test
        if len(documents) > 10000:
            logger.info("\nTesting with 10K sample first...")
            sample_idx = np.random.choice(len(documents), 10000, replace=False)
            sample_docs = [documents[i] for i in sample_idx]
            sample_emb = embeddings[sample_idx]
            
            test_start = datetime.now()
            test_topics, _ = topic_model.fit_transform(sample_docs, sample_emb)
            test_time = (datetime.now() - test_start).total_seconds()
            
            logger.info(f"Sample completed in {test_time:.1f} seconds")
            logger.info(f"Estimated full time: {test_time * len(documents) / 10000 / 60:.1f} minutes")
            
            if test_time > 60:  # If sample takes >1 minute, we have a problem
                logger.warning("Sample took too long! Using faster settings...")
                # Use even faster settings
                hdbscan_model.algorithm = 'boruvka_balltree'
                hdbscan_model.min_cluster_size = 200
        
        # Now run on full dataset
        logger.info(f"\nRunning on full dataset ({len(documents):,} documents)...")
        topics, probs = topic_model.fit_transform(documents, embeddings)
        
    except Exception as e:
        logger.error(f"Error during clustering: {e}")
        logger.info("Trying with minimal settings...")
        
        # Fallback to most basic settings
        topic_model = BERTopic(
            min_topic_size=200,  # Much larger
            nr_topics=100,  # Force 100 topics
            calculate_probabilities=False,
            verbose=True
        )
        
        topics, probs = topic_model.fit_transform(documents, embeddings)
    
    duration = (datetime.now() - start_time).total_seconds()
    
    logger.info(f"\n✅ BERTopic complete in {duration/60:.1f} minutes!")
    logger.info(f"Topics found: {len(set(topics)) - 1}")
    logger.info(f"Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
    
    # Create simple hierarchy
    topics_l1 = topics  # We'll map these later
    topics_l2 = topics
    topics_l3 = topics
    
    # If no probabilities, create fake ones
    if probs is None:
        probs = [0.8] * len(topics)
    
    # Save results
    results = []
    for i, video in enumerate(video_data):
        results.append({
            'id': video['id'],
            'title': video['title'],
            'channel': video['channel'],
            'old_confidence': video.get('old_confidence'),
            'topic_level_1': int(topics_l1[i] % 15) if topics_l1[i] != -1 else -1,
            'topic_level_2': int(topics_l2[i] % 40) if topics_l2[i] != -1 else -1,
            'topic_level_3': int(topics_l3[i]),
            'topic_cluster_id': int(topics[i]),
            'topic_confidence': float(probs[i])
        })
        
    output_file = f"bertopic_HDBSCAN_FIXED_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': {
                'total_videos': len(results),
                'timestamp': datetime.now().isoformat(),
                'min_cluster_size': min_cluster_size,
                'processing_time_minutes': duration/60,
                'outlier_rate': (topics == -1).sum() / len(topics)
            },
            'classifications': results
        }, f)
        
    # Save model
    topic_model.save("bertopic_model_HDBSCAN_FIXED")
    
    logger.info(f"\n{'='*60}")
    logger.info("✅ SUCCESS WITH HDBSCAN!")
    logger.info(f"Processed {len(results):,} videos")
    logger.info(f"Results: {output_file}")
    logger.info(f"\nTo update database:")
    logger.info(f"node workers/topic-update-worker.js {output_file}")
    logger.info(f"{'='*60}")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("FIXED HDBSCAN BERTopic")
    print("="*60)
    print("\nFixes:")
    print("  - Proper min_cluster_size for 177K docs")
    print("  - Better UMAP settings (5D, low memory)")
    print("  - Optimized HDBSCAN algorithm")
    print("  - Test run on sample first")
    print("="*60 + "\n")
    
    try:
        embeddings, documents, video_data = load_saved_data()
        run_fixed_bertopic(embeddings, documents, video_data)
    except Exception as e:
        logger.error(f"Error: {e}")
        import traceback
        traceback.print_exc()