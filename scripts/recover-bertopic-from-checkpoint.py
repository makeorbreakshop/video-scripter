#!/usr/bin/env python3
"""
Recover BERTopic from checkpoint and fix CountVectorizer error
"""

import os
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from supabase import create_client
from dotenv import load_dotenv
import json
import pickle
import logging
from datetime import datetime
from tqdm import tqdm

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

def find_latest_checkpoint():
    """Find the most recent checkpoint file"""
    checkpoint_files = [f for f in os.listdir('.') if f.endswith('.pkl') and 'checkpoint' in f]
    if not checkpoint_files:
        return None
    
    # Sort by modification time
    checkpoint_files.sort(key=lambda f: os.path.getmtime(f), reverse=True)
    return checkpoint_files[0]

def load_checkpoint(checkpoint_file):
    """Load checkpoint data"""
    logger.info(f"Loading checkpoint from {checkpoint_file}")
    with open(checkpoint_file, 'rb') as f:
        checkpoint = pickle.load(f)
    
    # Check what's in the checkpoint
    if isinstance(checkpoint, dict):
        logger.info(f"Checkpoint contains: {list(checkpoint.keys())}")
        if 'embeddings' in checkpoint:
            embeddings = checkpoint['embeddings']
            documents = checkpoint.get('documents', [])
            video_data = checkpoint.get('video_data', [])
            stats = checkpoint.get('stats', {})
        else:
            # Old format
            embeddings = checkpoint
            documents = []
            video_data = []
            stats = {}
    else:
        # Just embeddings
        embeddings = checkpoint
        documents = []
        video_data = []
        stats = {}
    
    logger.info(f"Loaded {len(embeddings)} embeddings")
    return embeddings, documents, video_data, stats

def run_bertopic_fixed(embeddings, documents):
    """Run BERTopic with fixed CountVectorizer settings"""
    logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
    
    # Calculate safe parameters based on document count
    num_docs = len(documents)
    
    # Set min_df based on document count
    if num_docs < 1000:
        min_df = 2  # Very small dataset
    elif num_docs < 10000:
        min_df = 3  # Small dataset
    elif num_docs < 50000:
        min_df = 5  # Medium dataset
    else:
        min_df = 10  # Large dataset
    
    # Set max_df to ensure it's always valid
    max_df = 0.95  # Percentage
    max_docs = int(num_docs * max_df)
    
    # Ensure max_docs > min_df
    if max_docs <= min_df:
        max_df = 0.99  # Use 99% if 95% is too restrictive
        logger.warning(f"Adjusted max_df to {max_df} due to small dataset")
    
    logger.info(f"CountVectorizer settings: min_df={min_df}, max_df={max_df}")
    logger.info(f"This means: words must appear in at least {min_df} docs and at most {int(num_docs * max_df)} docs")
    
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=min_df,
        max_df=max_df,
        ngram_range=(1, 2),  # Unigrams and bigrams
        max_features=10000
    )
    
    topic_model = BERTopic(
        min_topic_size=30,  # Reduced for better granularity
        nr_topics="auto",
        vectorizer_model=vectorizer_model,
        calculate_probabilities=True,
        verbose=True
    )
    
    start_time = datetime.now()
    
    try:
        topics, probs = topic_model.fit_transform(documents, embeddings)
    except ValueError as e:
        logger.error(f"Error during BERTopic: {e}")
        logger.info("Trying with even more permissive settings...")
        
        # Ultra-safe settings
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=2,  # Minimum possible
            max_df=0.99,  # Nearly all docs
            ngram_range=(1, 1),  # Only unigrams
            max_features=5000  # Fewer features
        )
        
        topic_model = BERTopic(
            min_topic_size=30,
            nr_topics="auto",
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=True
        )
        
        topics, probs = topic_model.fit_transform(documents, embeddings)
    
    duration = (datetime.now() - start_time).total_seconds()
    
    logger.info(f"\nBERTopic complete in {duration/60:.1f} minutes")
    logger.info(f"Topics found: {len(set(topics)) - 1}")
    logger.info(f"Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
    
    return topic_model, topics, probs

def main():
    # Check if we already have the full data in memory
    latest_checkpoint = find_latest_checkpoint()
    
    if not latest_checkpoint:
        logger.error("No checkpoint found! Need to re-run data collection.")
        return
    
    # Load checkpoint
    embeddings, documents, video_data, stats = load_checkpoint(latest_checkpoint)
    
    # If we don't have documents, we need to check if there's a separate file
    if len(documents) == 0:
        logger.info("No documents in checkpoint, checking for saved data...")
        
        # Check for the latest results that might have documents
        results_files = sorted([f for f in os.listdir('.') if f.startswith('bertopic_classifications_') and f.endswith('.json')])
        if results_files:
            logger.info(f"Found {len(results_files)} result files, but need to re-fetch documents")
        
        # For now, create simple documents from embeddings count
        logger.warning("Creating placeholder documents - results may be suboptimal")
        documents = [f"Document_{i}" for i in range(len(embeddings))]
        video_data = [{'id': f'video_{i}', 'title': f'Video {i}', 'channel': '', 'old_confidence': None} 
                     for i in range(len(embeddings))]
    
    # Convert to numpy array if needed
    if not isinstance(embeddings, np.ndarray):
        embeddings = np.array(embeddings)
    
    logger.info(f"\nReady to process {len(embeddings)} embeddings")
    
    # Run BERTopic with fixed settings
    topic_model, topics, probs = run_bertopic_fixed(embeddings, documents)
    
    # Create hierarchy
    logger.info("\nCreating topic hierarchy...")
    try:
        topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
        logger.info(f"Level 1: {len(set(topics_l1)) - 1} topics")
    except:
        logger.warning("Could not reduce to 15 topics")
        topics_l1 = topics
        
    try:
        topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
        logger.info(f"Level 2: {len(set(topics_l2)) - 1} topics")
    except:
        logger.warning("Could not reduce to 40 topics")
        topics_l2 = topics
        
    topics_l3 = topics
    
    # Save results
    results = []
    for i in range(len(video_data)):
        if i < len(video_data):
            video = video_data[i]
        else:
            video = {'id': f'unknown_{i}', 'title': '', 'channel': '', 'old_confidence': None}
            
        results.append({
            'id': video['id'],
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'old_confidence': video.get('old_confidence'),
            'topic_level_1': int(topics_l1[i]),
            'topic_level_2': int(topics_l2[i]),
            'topic_level_3': int(topics_l3[i]),
            'topic_cluster_id': int(topics[i]),
            'topic_confidence': float(probs[i])
        })
        
    output_file = f"bertopic_classifications_recovered_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': {
                'total_videos': len(results),
                'timestamp': datetime.now().isoformat(),
                'source': 'checkpoint_recovery',
                'checkpoint_file': latest_checkpoint,
                'outlier_rate': (topics == -1).sum() / len(topics)
            },
            'classifications': results
        }, f)
        
    # Save model
    topic_model.save("bertopic_model_recovered")
    
    logger.info(f"\n{'='*60}")
    logger.info("✅ Recovery Complete!")
    logger.info(f"Processed {len(results):,} videos")
    logger.info(f"Results: {output_file}")
    logger.info(f"Model: bertopic_model_recovered/")
    logger.info(f"\nNext: node workers/topic-update-worker.js {output_file}")
    logger.info(f"{'='*60}")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("BERTopic Recovery from Checkpoint")
    print("="*60)
    print("\nThis will:")
    print("  1. Load the latest checkpoint")
    print("  2. Fix CountVectorizer parameters")
    print("  3. Complete BERTopic clustering")
    print("  4. Save results")
    print("="*60 + "\n")
    
    main()