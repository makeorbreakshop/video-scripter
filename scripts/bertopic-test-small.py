#!/usr/bin/env python3
"""
TEST BERTopic on small sample - Make sure it works before running on all data
"""

import os
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from hdbscan import HDBSCAN
import pickle
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Test with different sample sizes
SAMPLE_SIZES = [1000, 5000, 10000]

def load_saved_data(sample_size=None):
    """Load the saved data"""
    logger.info(f"\nLoading saved data (sample_size={sample_size})...")
    
    with open('bertopic_embeddings.pkl', 'rb') as f:
        embeddings = pickle.load(f)
    
    with open('bertopic_documents.pkl', 'rb') as f:
        documents = pickle.load(f)
    
    logger.info(f"Total data: {len(embeddings):,} embeddings")
    
    if sample_size and sample_size < len(embeddings):
        # Random sample
        idx = np.random.choice(len(embeddings), sample_size, replace=False)
        embeddings = embeddings[idx]
        documents = [documents[i] for i in idx]
        logger.info(f"Using sample: {len(embeddings):,} embeddings")
    
    return embeddings, documents

def test_bertopic(sample_size):
    """Test BERTopic on a sample"""
    logger.info(f"\n{'='*60}")
    logger.info(f"TESTING WITH {sample_size:,} DOCUMENTS")
    logger.info(f"{'='*60}")
    
    # Load sample
    embeddings, documents = load_saved_data(sample_size)
    
    # Simple settings that should work
    min_cluster_size = max(30, int(np.sqrt(sample_size) / 4))
    logger.info(f"Using min_cluster_size={min_cluster_size}")
    
    # Configure models
    hdbscan_model = HDBSCAN(
        min_cluster_size=min_cluster_size,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=False
    )
    
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=2,
        max_df=0.95,
        max_features=1000  # Fewer features for test
    )
    
    topic_model = BERTopic(
        hdbscan_model=hdbscan_model,
        vectorizer_model=vectorizer_model,
        nr_topics="auto",
        calculate_probabilities=False,
        verbose=True
    )
    
    # Time it
    start_time = datetime.now()
    
    try:
        topics, _ = topic_model.fit_transform(documents, embeddings)
        duration = (datetime.now() - start_time).total_seconds()
        
        # Results
        n_topics = len(set(topics)) - 1
        outlier_rate = (topics == -1).sum() / len(topics) * 100
        
        logger.info(f"\n✅ SUCCESS in {duration:.1f} seconds!")
        logger.info(f"Topics found: {n_topics}")
        logger.info(f"Outlier rate: {outlier_rate:.1f}%")
        
        # Extrapolate to full dataset
        full_estimate = duration * (177000 / sample_size)
        logger.info(f"\nEstimated time for 177K docs: {full_estimate/60:.1f} minutes")
        
        return True, duration
        
    except Exception as e:
        logger.error(f"❌ FAILED: {e}")
        return False, 0

def main():
    logger.info("BERTopic Test on Small Samples")
    logger.info("This tests if BERTopic works before running on full data\n")
    
    # Test each sample size
    for size in SAMPLE_SIZES:
        success, time = test_bertopic(size)
        if not success:
            logger.error(f"\nTest failed at {size} documents!")
            break
        
        # If it's taking too long, warn
        if time > 60:
            logger.warning(f"\nTook {time:.0f}s for {size} docs - full dataset might be slow!")
    
    logger.info(f"\n{'='*60}")
    logger.info("Test complete! If all tests passed, run the full version.")
    logger.info(f"{'='*60}")

if __name__ == "__main__":
    main()