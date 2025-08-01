#!/usr/bin/env python3
"""
Quick BERTopic fix - Skip data download, jump straight to clustering
"""

import os
import sys
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
import json
import logging
from datetime import datetime

# Add the path to import from the safe script
sys.path.append(os.path.dirname(__file__))
from generate_bertopic_safe_300_iops import Safe300IOPSGenerator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Override the problematic method
class FixedBERTopicGenerator(Safe300IOPSGenerator):
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic with FIXED CountVectorizer settings"""
        logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
        
        # Fixed settings that won't cause the error
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=5,  # Absolute count, not percentage
            max_df=0.95,  # 95% of documents
            ngram_range=(1, 2),
            max_features=10000
        )
        
        # Just to be safe, let's check
        num_docs = len(documents)
        max_docs = int(num_docs * 0.95)
        logger.info(f"Document count: {num_docs}")
        logger.info(f"Min documents for a word: 5")
        logger.info(f"Max documents for a word: {max_docs}")
        
        if max_docs <= 5:
            # Ultra small dataset
            vectorizer_model = CountVectorizer(
                stop_words="english",
                min_df=1,
                max_df=0.99,
                ngram_range=(1, 1),
                max_features=1000
            )
            logger.warning("Using ultra-permissive settings for small dataset")
        
        topic_model = BERTopic(
            min_topic_size=30,  # Smaller clusters allowed
            nr_topics="auto",
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=True
        )
        
        start_time = datetime.now()
        topics, probs = topic_model.fit_transform(documents, embeddings)
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"\nBERTopic complete in {duration/60:.1f} minutes")
        logger.info(f"Topics found: {len(set(topics)) - 1}")
        logger.info(f"Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        return topic_model, topics, probs

if __name__ == "__main__":
    print("\n" + "="*60)
    print("BERTopic Quick Fix - Running with fixed parameters")
    print("="*60)
    print("\nThis will re-run the entire process but with fixed")
    print("CountVectorizer parameters that won't error out.")
    print("="*60 + "\n")
    
    # Use the fixed generator
    generator = FixedBERTopicGenerator(
        title_weight=0.3,
        summary_weight=0.7
    )
    
    try:
        generator.run()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
    except Exception as e:
        logger.error(f"\nError: {e}")
        import traceback
        traceback.print_exc()