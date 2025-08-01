#!/usr/bin/env python3
"""
Smarter BERTopic Hierarchical Clustering
1. First run BERTopic to find natural clusters
2. Analyze cluster size distribution
3. Create hierarchy by grouping clusters
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
from collections import Counter
import matplotlib.pyplot as plt

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
    
    # Save sample indices
    with open('bertopic_sample_indices.pkl', 'wb') as f:
        pickle.dump(sample_indices, f)
    
    return sample_indices, sample_embeddings, sample_documents

def run_initial_bertopic(sample_embeddings, sample_documents):
    """Run BERTopic with small min_cluster_size to find natural clusters"""
    logger.info("\n" + "="*60)
    logger.info("STEP 1: Finding natural clusters")
    logger.info("="*60)
    
    # UMAP
    umap_model = UMAP(
        n_neighbors=15,
        n_components=5,
        metric='cosine',
        random_state=42,
        verbose=True
    )
    
    # HDBSCAN with small min_cluster_size to find all natural clusters
    hdbscan_model = HDBSCAN(
        min_cluster_size=30,  # Small enough to find fine-grained topics
        min_samples=5,
        metric='euclidean',
        cluster_selection_method='eom',
        prediction_data=True
    )
    
    # Vectorizer
    vectorizer_model = CountVectorizer(
        stop_words="english",
        min_df=5,  # Lower threshold for initial clustering
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
    
    # Fit
    start_time = datetime.now()
    topics, _ = topic_model.fit_transform(sample_documents, sample_embeddings)
    elapsed = (datetime.now() - start_time).total_seconds()
    
    topic_info = topic_model.get_topic_info()
    n_topics = len(topic_info) - 1  # Exclude outlier
    
    logger.info(f"\n✅ Found {n_topics} natural clusters in {elapsed/60:.1f} minutes")
    
    return topic_model, topics, topic_info, umap_model, hdbscan_model

def analyze_cluster_distribution(topic_info):
    """Analyze the distribution of cluster sizes"""
    logger.info("\n" + "="*60)
    logger.info("STEP 2: Analyzing cluster distribution")
    logger.info("="*60)
    
    # Get cluster sizes (excluding outliers)
    sizes = topic_info[topic_info['Topic'] != -1]['Count'].values
    sizes_sorted = np.sort(sizes)[::-1]
    
    logger.info(f"Total clusters: {len(sizes)}")
    logger.info(f"Largest cluster: {sizes_sorted[0]:,} documents")
    logger.info(f"Smallest cluster: {sizes_sorted[-1]:,} documents")
    logger.info(f"Median cluster: {np.median(sizes):.0f} documents")
    
    # Find natural breakpoints for 3 levels
    # Level 1: Top 10-20 largest clusters
    # Level 2: Top 30-50 clusters  
    # Level 3: All clusters
    
    cumsum = np.cumsum(sizes_sorted)
    total = cumsum[-1]
    
    # Find how many clusters cover 50%, 80%, 90% of documents
    coverage_50 = np.argmax(cumsum >= total * 0.5) + 1
    coverage_80 = np.argmax(cumsum >= total * 0.8) + 1
    coverage_90 = np.argmax(cumsum >= total * 0.9) + 1
    
    logger.info(f"\nCoverage analysis:")
    logger.info(f"Top {coverage_50} clusters cover 50% of documents")
    logger.info(f"Top {coverage_80} clusters cover 80% of documents")
    logger.info(f"Top {coverage_90} clusters cover 90% of documents")
    
    # Suggest hierarchy levels
    suggested_l1 = min(20, coverage_50)  # 10-20 super categories
    suggested_l2 = min(50, coverage_80)  # 30-50 main categories
    suggested_l3 = len(sizes)  # All clusters
    
    logger.info(f"\nSuggested hierarchy:")
    logger.info(f"Level 1: {suggested_l1} super categories (top clusters)")
    logger.info(f"Level 2: {suggested_l2} main categories")
    logger.info(f"Level 3: {suggested_l3} fine-grained topics")
    
    # Plot distribution
    plt.figure(figsize=(10, 6))
    plt.subplot(2, 1, 1)
    plt.plot(sizes_sorted, 'b-')
    plt.axvline(x=suggested_l1, color='r', linestyle='--', label=f'L1: {suggested_l1} topics')
    plt.axvline(x=suggested_l2, color='g', linestyle='--', label=f'L2: {suggested_l2} topics')
    plt.ylabel('Cluster Size')
    plt.xlabel('Cluster Rank')
    plt.yscale('log')
    plt.legend()
    plt.title('Cluster Size Distribution')
    
    plt.subplot(2, 1, 2)
    plt.plot(cumsum / total * 100, 'b-')
    plt.axvline(x=suggested_l1, color='r', linestyle='--')
    plt.axvline(x=suggested_l2, color='g', linestyle='--')
    plt.ylabel('Cumulative Coverage (%)')
    plt.xlabel('Number of Clusters')
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig('cluster_distribution_analysis.png')
    logger.info("\nSaved distribution plot to cluster_distribution_analysis.png")
    
    return suggested_l1, suggested_l2, suggested_l3, sizes_sorted

def create_hierarchical_grouping(topic_model, topics, topic_info, l1_size, l2_size):
    """Create hierarchy by grouping existing clusters"""
    logger.info("\n" + "="*60)
    logger.info("STEP 3: Creating hierarchical grouping")
    logger.info("="*60)
    
    # Get topic embeddings (c-TF-IDF representations)
    topic_embeddings = topic_model.topic_embeddings_
    
    # Remove outlier topic embedding if present
    if -1 in topic_model.get_topics():
        # Find the index of topic -1
        topic_ids = sorted(topic_model.get_topics().keys())
        outlier_idx = topic_ids.index(-1)
        # Remove outlier from embeddings
        topic_embeddings = np.delete(topic_embeddings, outlier_idx, axis=0)
        # Get valid topic IDs (excluding -1)
        valid_topics = [t for t in topic_ids if t != -1]
    else:
        valid_topics = sorted(topic_model.get_topics().keys())
    
    # Create mappings
    from sklearn.cluster import KMeans
    
    # Level 2: Group all topics into l2_size categories
    logger.info(f"Grouping {len(valid_topics)} topics into {l2_size} Level 2 categories...")
    kmeans_l2 = KMeans(n_clusters=l2_size, random_state=42, n_init=10)
    l2_labels = kmeans_l2.fit_predict(topic_embeddings)
    
    # Create topic to L2 mapping
    topic_to_l2 = {valid_topics[i]: l2_labels[i] for i in range(len(valid_topics))}
    
    # Level 1: Group L2 categories into l1_size super categories
    logger.info(f"Grouping {l2_size} Level 2 categories into {l1_size} Level 1 super categories...")
    l2_embeddings = kmeans_l2.cluster_centers_
    kmeans_l1 = KMeans(n_clusters=l1_size, random_state=42, n_init=10)
    l1_labels = kmeans_l1.fit_predict(l2_embeddings)
    
    # Create L2 to L1 mapping
    l2_to_l1 = {i: l1_labels[i] for i in range(l2_size)}
    
    # Create full mapping for each document
    doc_to_hierarchy = {}
    for idx, topic in enumerate(topics):
        if topic == -1:  # Outlier
            doc_to_hierarchy[idx] = {
                'l3': -1,
                'l2': -1,
                'l1': -1
            }
        else:
            l2 = topic_to_l2.get(topic, -1)
            l1 = l2_to_l1.get(l2, -1) if l2 != -1 else -1
            doc_to_hierarchy[idx] = {
                'l3': topic,
                'l2': l2,
                'l1': l1
            }
    
    logger.info("\n✅ Hierarchical grouping complete")
    
    # Show example hierarchy
    logger.info("\nExample hierarchy structure:")
    for l1 in range(min(3, l1_size)):
        logger.info(f"\nL1 Category {l1}:")
        l2_in_l1 = [l2 for l2, parent in l2_to_l1.items() if parent == l1][:3]
        for l2 in l2_in_l1:
            logger.info(f"  └─ L2 Category {l2}:")
            l3_in_l2 = [l3 for l3, parent in topic_to_l2.items() if parent == l2][:2]
            for l3 in l3_in_l2:
                topic_words = [word for word, _ in topic_model.get_topic(l3)[:3]]
                logger.info(f"      └─ L3 Topic {l3}: {', '.join(topic_words)}")
    
    return doc_to_hierarchy, topic_to_l2, l2_to_l1

def main():
    """Run the analysis-based hierarchical clustering"""
    
    # Load data
    embeddings, documents, video_data = load_saved_data()
    
    # Create sample
    sample_indices, sample_embeddings, sample_documents = stratified_sample(embeddings, documents)
    
    # Step 1: Find natural clusters
    topic_model, topics, topic_info, umap_model, hdbscan_model = run_initial_bertopic(
        sample_embeddings, sample_documents
    )
    
    # Step 2: Analyze distribution
    l1_size, l2_size, l3_size, sizes = analyze_cluster_distribution(topic_info)
    
    # Ask user to confirm or adjust
    print(f"\nBased on the analysis, I recommend:")
    print(f"- Level 1: {l1_size} super categories")
    print(f"- Level 2: {l2_size} main categories") 
    print(f"- Level 3: {l3_size} fine topics")
    print(f"\nPress Enter to continue with these values, or type new values (e.g., '15,40,130'):")
    
    user_input = input().strip()
    if user_input:
        try:
            l1_size, l2_size, l3_size = map(int, user_input.split(','))
            logger.info(f"Using custom hierarchy: L1={l1_size}, L2={l2_size}, L3={l3_size}")
        except:
            logger.info("Invalid input, using recommended values")
    
    # Step 3: Create hierarchical grouping
    doc_hierarchy, topic_to_l2, l2_to_l1 = create_hierarchical_grouping(
        topic_model, topics, topic_info, l1_size, l2_size
    )
    
    # Step 4: Assign all documents
    logger.info("\n" + "="*60)
    logger.info("STEP 4: Assigning all documents")
    logger.info("="*60)
    
    # First, assign L3 topics to all documents
    all_topics_l3 = np.zeros(len(embeddings), dtype=int) - 1
    all_topics_l3[sample_indices] = topics
    
    # Assign remaining documents
    remaining_indices = np.setdiff1d(np.arange(len(embeddings)), sample_indices)
    if len(remaining_indices) > 0:
        logger.info(f"Assigning {len(remaining_indices):,} remaining documents...")
        
        # Transform and predict
        remaining_embeddings = embeddings[remaining_indices]
        
        # Use the fitted UMAP
        from tqdm import tqdm
        batch_size = 5000
        remaining_reduced = []
        
        for i in tqdm(range(0, len(remaining_embeddings), batch_size), desc="UMAP transform"):
            batch = remaining_embeddings[i:i+batch_size]
            batch_reduced = umap_model.transform(batch)
            remaining_reduced.append(batch_reduced)
        
        remaining_reduced = np.vstack(remaining_reduced)
        
        # Predict clusters
        try:
            import hdbscan
            remaining_labels, _ = hdbscan.approximate_predict(hdbscan_model, remaining_reduced)
        except:
            logger.warning("approximate_predict failed, using fallback")
            remaining_labels = np.zeros(len(remaining_reduced), dtype=int) - 1
        
        all_topics_l3[remaining_indices] = remaining_labels
    
    # Create L2 and L1 assignments for all documents
    all_topics_l2 = np.zeros(len(embeddings), dtype=int) - 1
    all_topics_l1 = np.zeros(len(embeddings), dtype=int) - 1
    
    for i in range(len(embeddings)):
        l3 = all_topics_l3[i]
        if l3 != -1 and l3 in topic_to_l2:
            l2 = topic_to_l2[l3]
            all_topics_l2[i] = l2
            if l2 in l2_to_l1:
                all_topics_l1[i] = l2_to_l1[l2]
    
    # Save results
    logger.info("\nSaving results...")
    
    results = []
    for i in range(len(video_data)):
        video = video_data[i] if i < len(video_data) else {'id': f'unknown_{i}'}
        results.append({
            'id': video.get('id', f'unknown_{i}'),
            'title': video.get('title', ''),
            'channel': video.get('channel', ''),
            'topic_level_1': int(all_topics_l1[i]),
            'topic_level_2': int(all_topics_l2[i]),
            'topic_level_3': int(all_topics_l3[i]),
            'topic_confidence': 0.8
        })
    
    output_file = f"bertopic_smart_hierarchy_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    
    with open(output_file, 'w') as f:
        json.dump({
            'metadata': {
                'total_videos': len(results),
                'hierarchy_sizes': {
                    'level_1': int(l1_size),
                    'level_2': int(l2_size),
                    'level_3': int(l3_size)
                },
                'actual_topics': {
                    'level_1': int(len(np.unique(all_topics_l1[all_topics_l1 != -1]))),
                    'level_2': int(len(np.unique(all_topics_l2[all_topics_l2 != -1]))),
                    'level_3': int(len(np.unique(all_topics_l3[all_topics_l3 != -1])))
                },
                'mappings': {
                    'topic_to_l2': {str(k): int(v) for k, v in topic_to_l2.items()},
                    'l2_to_l1': {str(k): int(v) for k, v in l2_to_l1.items()}
                }
            },
            'classifications': results
        }, f, indent=2)
    
    # Save the topic model
    model_dir = f"bertopic_model_smart_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    topic_model.save(model_dir)
    
    logger.info(f"\n✅ Results saved to: {output_file}")
    logger.info(f"✅ Model saved to: {model_dir}")
    logger.info(f"\nNext step: python scripts/generate-topic-names-with-llm.py {output_file}")

if __name__ == "__main__":
    print("\n" + "="*60)
    print("SMART HIERARCHICAL BERTOPIC")
    print("="*60)
    print("\nThis approach:")
    print("1. Runs BERTopic once to find natural clusters")
    print("2. Analyzes the distribution to determine hierarchy")
    print("3. Groups clusters into levels based on similarity")
    print("4. No more guessing min_cluster_size!")
    print("="*60 + "\n")
    
    main()