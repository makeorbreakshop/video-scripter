#!/usr/bin/env python3
"""
Validate that our sampling approach captures all major topics
"""

import numpy as np
import pickle
from sklearn.cluster import MiniBatchKMeans
from collections import Counter
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def analyze_sampling_coverage():
    """Analyze what topics we might miss with different sample sizes"""
    
    # Load embeddings
    with open('bertopic_embeddings.pkl', 'rb') as f:
        embeddings = pickle.load(f)
    if not isinstance(embeddings, np.ndarray):
        embeddings = np.array(embeddings)
    
    logger.info(f"Total embeddings: {len(embeddings):,}")
    
    # First, do a quick clustering to estimate topic distribution
    logger.info("\nEstimating topic distribution with fast K-Means...")
    
    # Use more clusters to catch small topics
    kmeans = MiniBatchKMeans(n_clusters=1000, batch_size=1000, random_state=42)
    labels = kmeans.fit_predict(embeddings)
    
    # Analyze cluster sizes
    cluster_sizes = Counter(labels)
    sizes = list(cluster_sizes.values())
    sizes.sort(reverse=True)
    
    logger.info(f"\nFound {len(cluster_sizes)} initial clusters")
    logger.info(f"Largest cluster: {sizes[0]:,} videos")
    logger.info(f"Smallest cluster: {sizes[-1]:,} videos")
    logger.info(f"Clusters with 50+ videos: {sum(1 for s in sizes if s >= 50)}")
    
    # Simulate different sampling strategies
    sample_sizes = [10000, 20000, 30000, 40000]
    
    for sample_size in sample_sizes:
        logger.info(f"\n{'='*50}")
        logger.info(f"Sample size: {sample_size:,} ({sample_size/len(embeddings)*100:.1f}%)")
        
        # Random sampling
        random_sample = np.random.choice(len(embeddings), sample_size, replace=False)
        random_labels = labels[random_sample]
        random_clusters = set(random_labels)
        random_coverage = len(random_clusters) / len(cluster_sizes) * 100
        
        # Count how many 50+ clusters we'd catch
        caught_clusters = []
        missed_clusters = []
        for cluster_id, size in cluster_sizes.items():
            if size >= 50:  # HDBSCAN min_cluster_size
                if cluster_id in random_clusters:
                    caught_clusters.append(size)
                else:
                    missed_clusters.append(size)
        
        logger.info(f"Random sampling:")
        logger.info(f"  - Clusters found: {len(random_clusters)}/{len(cluster_sizes)} ({random_coverage:.1f}%)")
        logger.info(f"  - Large (50+) clusters found: {len(caught_clusters)}/{len(caught_clusters)+len(missed_clusters)}")
        if missed_clusters:
            logger.info(f"  - Largest missed cluster: {max(missed_clusters)} videos")
        
        # Stratified sampling (like our approach)
        # Create strata
        n_strata = min(100, len(embeddings) // 1000)
        kmeans_strata = MiniBatchKMeans(n_clusters=n_strata, random_state=42)
        strata_labels = kmeans_strata.fit_predict(embeddings)
        
        # Sample from each stratum
        stratified_sample = []
        samples_per_stratum = sample_size // n_strata
        for stratum in range(n_strata):
            stratum_indices = np.where(strata_labels == stratum)[0]
            if len(stratum_indices) > samples_per_stratum:
                sampled = np.random.choice(stratum_indices, samples_per_stratum, replace=False)
            else:
                sampled = stratum_indices
            stratified_sample.extend(sampled)
        
        stratified_labels = labels[stratified_sample]
        stratified_clusters = set(stratified_labels)
        stratified_coverage = len(stratified_clusters) / len(cluster_sizes) * 100
        
        # Count coverage for stratified
        caught_strat = []
        missed_strat = []
        for cluster_id, size in cluster_sizes.items():
            if size >= 50:
                if cluster_id in stratified_clusters:
                    caught_strat.append(size)
                else:
                    missed_strat.append(size)
        
        logger.info(f"\nStratified sampling:")
        logger.info(f"  - Clusters found: {len(stratified_clusters)}/{len(cluster_sizes)} ({stratified_coverage:.1f}%)")
        logger.info(f"  - Large (50+) clusters found: {len(caught_strat)}/{len(caught_strat)+len(missed_strat)}")
        if missed_strat:
            logger.info(f"  - Largest missed cluster: {max(missed_strat) if missed_strat else 0} videos")
        
        # Show improvement
        improvement = (stratified_coverage - random_coverage) / random_coverage * 100
        logger.info(f"\nStratified is {improvement:.1f}% better than random sampling")

if __name__ == "__main__":
    analyze_sampling_coverage()