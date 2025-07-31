#!/usr/bin/env python3
"""
Generate BERTopic classifications using combined title+summary embeddings.
Saves results to JSON file for separate database update process.
"""

import os
import sys
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
from pinecone import Pinecone
from supabase import create_client
from dotenv import load_dotenv
import json
from tqdm import tqdm
import logging
from datetime import datetime
import pickle

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

# Supabase setup
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

# Pinecone setup
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod')

class BERTopicGenerator:
    def __init__(self, batch_size=5000, title_weight=0.3, summary_weight=0.7):
        self.batch_size = batch_size
        self.title_weight = title_weight
        self.summary_weight = summary_weight
        self.conn = None
        self.pc = None
        self.index = None
        
    def connect(self):
        """Initialize connections"""
        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        self.pc = Pinecone(api_key=PINECONE_API_KEY)
        self.index = self.pc.Index(PINECONE_INDEX_NAME)  # Capital I
        logger.info("Connected to Supabase and Pinecone")
        
    def fetch_videos(self, limit=None, offset=0):
        """Fetch videos with both embeddings"""
        # Build query
        query = self.supabase.table('videos') \
            .select('id, title, metadata, topic_confidence') \
            .eq('pinecone_embedded', True) \
            .eq('llm_summary_embedding_synced', True) \
            .order('id')
        
        # Apply range
        if limit:
            query = query.range(offset, offset + limit - 1)
        else:
            query = query.range(offset, offset + 9999)
            
        result = query.execute()
        
        # Extract channel from metadata
        videos = []
        if result.data:
            for row in result.data:
                channel = ''
                if row.get('metadata'):
                    channel = row['metadata'].get('channelTitle', '') or \
                             row['metadata'].get('channel_title', '') or ''
                
                videos.append([
                    row['id'],
                    row['title'],
                    channel,
                    row.get('topic_confidence')
                ])
            
        logger.info(f"Fetched {len(videos)} videos (offset: {offset})")
        return videos
        
    def fetch_embeddings_batch(self, video_ids):
        """Fetch and combine embeddings from Pinecone"""
        # Fetch title embeddings from default namespace
        title_response = self.index.fetch(ids=video_ids, namespace='')
        
        # Fetch summary embeddings from llm-summaries namespace  
        summary_response = self.index.fetch(ids=video_ids, namespace='llm-summaries')
        
        combined_embeddings = []
        valid_ids = []
        missing_ids = []
        
        for vid in video_ids:
            if vid in title_response.vectors and vid in summary_response.vectors:
                title_emb = np.array(title_response.vectors[vid].values)
                summary_emb = np.array(summary_response.vectors[vid].values)
                
                # Weighted average (both are 512D from OpenAI)
                combined = (self.title_weight * title_emb + 
                           self.summary_weight * summary_emb)
                
                combined_embeddings.append(combined)
                valid_ids.append(vid)
            else:
                missing_ids.append(vid)
                
        if missing_ids:
            logger.warning(f"Missing embeddings for {len(missing_ids)} videos")
            
        return np.array(combined_embeddings), valid_ids
        
    def get_total_video_count(self):
        """Get total number of videos with both embeddings"""
        # Use a simple count query
        result = self.supabase.table('videos') \
            .select('id', count='exact') \
            .eq('pinecone_embedded', True) \
            .eq('llm_summary_embedding_synced', True) \
            .execute()
        return result.count if result.count else 0
    
    def process_all_videos(self):
        """Process all videos and collect embeddings"""
        # Get total count for progress tracking
        total_videos = self.get_total_video_count()
        logger.info(f"Total videos to process: {total_videos:,}")
        
        all_embeddings = []
        all_documents = []
        all_video_data = []
        
        offset = 0
        total_processed = 0
        missing_count = 0
        
        # Progress bar
        pbar = tqdm(total=total_videos, desc="Fetching embeddings", unit="videos")
        
        while True:
            # Fetch batch of videos
            videos = self.fetch_videos(limit=self.batch_size, offset=offset)
            if not videos:
                break
                
            video_ids = [v[0] for v in videos]
            
            # Fetch embeddings
            embeddings, valid_ids = self.fetch_embeddings_batch(video_ids)
            missing_count += len(video_ids) - len(valid_ids)
            
            # Store valid data
            for vid in valid_ids:
                idx = video_ids.index(vid)
                video = videos[idx]
                
                all_embeddings.append(embeddings[valid_ids.index(vid)])
                # Use title + channel for document representation
                doc = f"{video[1]} - {video[2]}" if video[2] else video[1]
                all_documents.append(doc)
                all_video_data.append({
                    'id': video[0],
                    'title': video[1],
                    'channel': video[2],
                    'old_confidence': video[3]
                })
                
            total_processed += len(videos)
            offset += self.batch_size
            
            # Update progress
            pbar.update(len(videos))
            pbar.set_postfix({
                'valid': len(all_video_data),
                'missing': missing_count,
                'batch_size': len(valid_ids)
            })
            
            # Save checkpoint every 50k videos
            if len(all_video_data) > 0 and len(all_video_data) % 50000 == 0:
                self._save_checkpoint(all_embeddings, all_documents, all_video_data)
                logger.info(f"\nCheckpoint saved at {len(all_video_data):,} videos")
                
        pbar.close()
        
        logger.info(f"\nEmbedding collection complete:")
        logger.info(f"  Total videos checked: {total_processed:,}")
        logger.info(f"  Valid embeddings found: {len(all_video_data):,}")
        logger.info(f"  Missing embeddings: {missing_count:,}")
        
        return np.array(all_embeddings), all_documents, all_video_data
        
    def _save_checkpoint(self, embeddings, documents, video_data):
        """Save checkpoint data"""
        checkpoint = {
            'embeddings': embeddings,
            'documents': documents,
            'video_data': video_data,
            'timestamp': datetime.now().isoformat()
        }
        
        filename = f"bertopic_checkpoint_{len(video_data)}.pkl"
        with open(filename, 'wb') as f:
            pickle.dump(checkpoint, f)
            
        logger.info(f"Saved checkpoint: {filename}")
        
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic clustering"""
        logger.info(f"\nStarting BERTopic clustering on {len(documents):,} documents...")
        logger.info("This may take 10-30 minutes depending on your system...")
        
        # Configure BERTopic for better topics
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=10,
            max_df=0.95,
            ngram_range=(1, 3)
        )
        
        topic_model = BERTopic(
            min_topic_size=50,  # Minimum cluster size
            nr_topics="auto",   # Auto-determine optimal number
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=True
        )
        
        # Fit the model with progress tracking
        logger.info("Fitting BERTopic model...")
        start_time = datetime.now()
        
        topics, probs = topic_model.fit_transform(documents, embeddings)
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        logger.info(f"\nBERTopic clustering complete in {duration:.1f} seconds")
        logger.info(f"Found {len(set(topics)) - 1} topics (excluding outliers)")
        logger.info(f"Outlier percentage: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        # Print topic distribution
        topic_counts = {}
        for t in topics:
            topic_counts[t] = topic_counts.get(t, 0) + 1
            
        sorted_topics = sorted(topic_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        logger.info("\nTop 10 topics by size:")
        for topic_id, count in sorted_topics:
            if topic_id != -1:
                logger.info(f"  Topic {topic_id}: {count:,} videos")
        
        return topic_model, topics, probs
        
    def create_hierarchical_structure(self, topic_model, embeddings):
        """Create 3-level hierarchical clustering"""
        logger.info("\nCreating hierarchical topic structure...")
        logger.info("This will create 3 levels of topics:")
        logger.info("  Level 1: ~10-20 broad domains")
        logger.info("  Level 2: ~30-50 main categories")
        logger.info("  Level 3: Original fine-grained topics")
        
        # Get hierarchical topics
        logger.info("\nGenerating topic hierarchy...")
        hierarchical_topics = topic_model.hierarchical_topics(embeddings)
        
        # Reduce to 3 levels with progress tracking
        logger.info("\nReducing to Level 1 (domains)...")
        topics_level_1 = topic_model.reduce_topics(embeddings, nr_topics=15)
        logger.info(f"Level 1: {len(set(topics_level_1)) - 1} domains (plus outliers)")
        
        logger.info("\nReducing to Level 2 (categories)...")
        topics_level_2 = topic_model.reduce_topics(embeddings, nr_topics=40)
        logger.info(f"Level 2: {len(set(topics_level_2)) - 1} categories (plus outliers)")
        
        # Level 3: Keep original fine-grained topics
        topics_level_3 = topic_model.topics_
        logger.info(f"Level 3: {len(set(topics_level_3)) - 1} micro-topics (plus outliers)")
        
        return topics_level_1, topics_level_2, topics_level_3
        
    def save_results(self, video_data, topics, probs, topics_l1, topics_l2, topics_l3, topic_model):
        """Save all results to files"""
        logger.info("Saving results...")
        
        # Prepare results
        results = []
        for i, video in enumerate(video_data):
            results.append({
                'id': video['id'],
                'title': video['title'],
                'channel': video['channel'],
                'old_confidence': video['old_confidence'],
                'topic_level_1': int(topics_l1[i]),
                'topic_level_2': int(topics_l2[i]),
                'topic_level_3': int(topics_l3[i]),
                'topic_cluster_id': int(topics[i]),
                'topic_confidence': float(probs[i])
            })
            
        # Save classifications
        output_file = f"bertopic_classifications_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump({
                'metadata': {
                    'total_videos': len(results),
                    'timestamp': datetime.now().isoformat(),
                    'title_weight': self.title_weight,
                    'summary_weight': self.summary_weight,
                    'outlier_rate': (topics == -1).sum() / len(topics)
                },
                'classifications': results
            }, f)
            
        logger.info(f"Saved classifications to {output_file}")
        
        # Save topic model
        model_path = "bertopic_model_combined"
        topic_model.save(model_path)
        logger.info(f"Saved topic model to {model_path}")
        
        # Export topic info
        topic_info = topic_model.get_topic_info()
        topic_info.to_csv("topic_info_combined.csv")
        
        # Save topic keywords for each level
        with open("topic_keywords.json", 'w') as f:
            json.dump({
                'level_1': {str(t): topic_model.get_topic(t) for t in set(topics_l1) if t != -1},
                'level_2': {str(t): topic_model.get_topic(t) for t in set(topics_l2) if t != -1},
                'level_3': {str(t): topic_model.get_topic(t) for t in set(topics_l3) if t != -1}
            }, f, indent=2)
            
        return output_file
        
    def run(self):
        """Main execution"""
        self.connect()
        
        try:
            # Process all videos
            embeddings, documents, video_data = self.process_all_videos()
            
            logger.info(f"Collected {len(embeddings)} videos with embeddings")
            
            # Run BERTopic
            topic_model, topics, probs = self.run_bertopic(embeddings, documents)
            
            # Create hierarchical structure
            topics_l1, topics_l2, topics_l3 = self.create_hierarchical_structure(
                topic_model, embeddings
            )
            
            # Save everything
            output_file = self.save_results(
                video_data, topics, probs, 
                topics_l1, topics_l2, topics_l3,
                topic_model
            )
            
            logger.info(f"\n{'='*60}")
            logger.info("✅ BERTopic Classification Complete!")
            logger.info(f"{'='*60}")
            logger.info(f"\nResults saved to: {output_file}")
            logger.info(f"Topic model saved to: bertopic_model_combined/")
            logger.info(f"Topic keywords saved to: topic_keywords.json")
            logger.info(f"\nTo apply these classifications to the database, run:")
            logger.info(f"  node workers/topic-update-worker.js {output_file}")
            logger.info(f"\nStatistics:")
            logger.info(f"  - Total videos: {len(video_data):,}")
            logger.info(f"  - Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
            logger.info(f"  - Number of topics: {len(set(topics)) - 1}")
            
        finally:
            pass  # Supabase client doesn't need explicit closing
                

if __name__ == "__main__":
    print("\n" + "="*60)
    print("BERTopic Classification with Combined Embeddings")
    print("="*60)
    print("\nThis script will:")
    print("1. Fetch title and summary embeddings from Pinecone")
    print("2. Combine them (30% title + 70% summary)")
    print("3. Run BERTopic clustering")
    print("4. Create 3-tier hierarchical structure")
    print("5. Save results for database update")
    print("\nEstimated time: 30-60 minutes for 180k videos")
    print("="*60 + "\n")
    
    generator = BERTopicGenerator(
        batch_size=5000,
        title_weight=0.3,
        summary_weight=0.7
    )
    
    try:
        generator.run()
    except KeyboardInterrupt:
        print("\n\nProcess interrupted by user")
        print("Checkpoints have been saved and can be resumed")
    except Exception as e:
        logger.error(f"\nError: {e}")
        import traceback
        traceback.print_exc()
