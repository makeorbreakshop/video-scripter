# BERTopic Clustering Todo List

## Overview
Migrating from 1,107 outdated clusters (based on 50K videos) to fresh clustering on 170K videos using SBERT + BERTopic.

## ✅ Completed Tasks

### Research & Analysis
- [x] Research modern topic clustering approaches (SBERT, HDBSCAN, BERTopic)
- [x] Extract 170K embeddings from Pinecone (saved as 17 part files in `/scripts/clustering/`)
- [x] Document embedding extraction process in `/docs/embedding-extraction-process.md`
- [x] Test HDBSCAN on raw OpenAI embeddings (30K sample)
- [x] Diagnose why HDBSCAN failed (embeddings too sparse, mean similarity 0.17)
- [x] Discover previous BERTopic success used UMAP reduction (512D → 10D)

### Current State Assessment
- [x] Find existing BERTopic clusters (1,107 clusters from July 11)
- [x] Verify database growth (170K videos now, 3x increase from 50K)
- [x] Check existing topic assignments (have topic_level_1/2/3 but no semantic names)
- [x] Locate existing scripts (`generate-cluster-names.js`, `save-cluster-names-to-db.js`)
- [x] Confirm need for fresh clustering due to 3x data growth

## 🔄 In Progress Tasks

- [x] Install required packages ✅ (confirmed via test_bertopic_small.py)
  - [x] `pip install sentence-transformers`
  - [x] `pip install bertopic`
  - [x] `pip install umap-learn`
  - [x] `pip install hdbscan`
- [x] Test BERTopic on sample data (25 documents, found 2 meaningful clusters)

## 📋 Pending Tasks - High Priority

### SBERT Embedding Generation
- [ ] Create script to generate SBERT embeddings for 170K videos 🔄 IN PROGRESS
- [ ] Choose appropriate SBERT model (e.g., 'all-MiniLM-L6-v2')
- [ ] Batch process videos to manage memory
- [ ] Save SBERT embeddings locally (estimated 2-5 minutes on M1/M2)

### BERTopic Clustering
- [ ] Run BERTopic on all 170K videos
- [ ] Configure parameters (min_cluster_size, min_samples)
- [ ] Expect ~2,000 natural clusters (vs 1,107 old ones)
- [ ] Save BERTopic model for future use

### Cluster Analysis & Naming
- [ ] Extract keywords and patterns for each cluster
- [ ] Generate semantic names using Claude API (already have `generate-cluster-names.js`)
- [ ] Review and validate cluster quality
- [ ] Handle outliers and noise points

### Database Integration
- [ ] Create `bertopic_clusters` table schema
- [ ] Save cluster assignments to videos table
- [ ] Update topic_level_1/2/3 with new hierarchy
- [ ] Store cluster metadata (keywords, centroids, sizes)

## 🏗️ Pending Tasks - Infrastructure

### Incremental Updates
- [ ] Build pipeline to assign new videos to existing clusters
- [ ] Create batch processing for daily imports
- [ ] Implement confidence scoring for assignments
- [ ] Design outlier detection for cluster drift

### Monitoring & Maintenance
- [ ] Create cluster evolution tracking system
- [ ] Set up weekly health checks for cluster quality
- [ ] Implement monthly retrain triggers (>20% outliers)
- [ ] Build cluster splitting/merging detection

### Documentation
- [ ] Document dual embedding architecture
  - [ ] OpenAI embeddings for search (keep existing)
  - [ ] SBERT embeddings for clustering (new system)
- [ ] Create clustering pipeline documentation
- [ ] Document API endpoints for cluster queries

## 💡 Technical Notes

### Why Fresh Clustering?
- Current clusters based on ~50K videos (July 2025)
- Now have 170K videos (3x growth)
- Missing new content patterns and niches
- Old clusters becoming too broad

### Architecture Decision
- **Search**: Continue using OpenAI embeddings → Pinecone
- **Clustering**: New SBERT embeddings → BERTopic
- **Rationale**: Different embeddings optimized for different tasks

### Expected Improvements
- More granular topics (1,107 → ~2,000 clusters)
- Better coverage of new content
- Natural topic discovery
- Faster daily assignments (5ms per video)

## 🚀 Next Immediate Steps

1. Install sentence-transformers and bertopic packages
2. Create SBERT embedding generation script
3. Run on small sample (1K videos) to test
4. Scale to full 170K dataset
5. Run BERTopic clustering
6. Generate semantic names

## 📊 Success Metrics

- [ ] All 170K videos assigned to clusters
- [ ] Average cluster size: 50-200 videos
- [ ] Noise/outliers: <10%
- [ ] Semantic names generated for all clusters
- [ ] Daily assignment pipeline operational
- [ ] < 1 second to assign new video to cluster