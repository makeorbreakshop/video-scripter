#!/usr/bin/env python3
"""
Balanced BERTopic Classification Generator

Optimized for 500 IOPS limit - uses ~300-400 IOPS for faster processing.
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
import time

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

# Supabase setup
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

# Pinecone setup
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod')

class BalancedBERTopicGenerator:
    def __init__(self, title_weight=0.3, summary_weight=0.7):
        # Balanced configuration for 500 IOPS limit
        self.supabase_batch_size = 1000  # Reasonable batch size
        self.pinecone_batch_size = 500   # Pinecone can handle more
        self.delay_between_batches = 0.2  # 200ms delay (allows ~5 batches/second = 5000 rows/sec)
        
        self.title_weight = title_weight
        self.summary_weight = summary_weight
        self.supabase = None
        self.pc = None
        self.index = None
        
    def connect(self):
        """Initialize connections"""
        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        self.pc = Pinecone(api_key=PINECONE_API_KEY)
        self.index = self.pc.Index(PINECONE_INDEX_NAME)
        logger.info("Connected to Supabase and Pinecone")
        
    def fetch_all_video_data(self):
        """Fetch all video data efficiently"""
        logger.info("\nFetching video data from Supabase...")
        
        # First get count
        count_result = self.supabase.table('videos') \
            .select('id', count='exact') \
            .eq('pinecone_embedded', True) \
            .eq('llm_summary_embedding_synced', True) \
            .limit(1) \
            .execute()
        
        total_count = count_result.count
        logger.info(f"Total videos to process: {total_count:,}")
        logger.info(f"Using batch size: {self.supabase_batch_size}")
        logger.info(f"Estimated Supabase queries: {total_count // self.supabase_batch_size + 1}")
        logger.info(f"Estimated time for Supabase: {(total_count // self.supabase_batch_size * self.delay_between_batches / 60):.1f} minutes\n")
        
        all_videos = []
        offset = 0
        
        pbar = tqdm(total=total_count, desc="Fetching from Supabase", unit="videos")
        
        while offset < total_count:
            # Fetch batch
            result = self.supabase.table('videos') \
                .select('id, title, metadata, topic_confidence') \
                .eq('pinecone_embedded', True) \
                .eq('llm_summary_embedding_synced', True) \
                .order('id') \
                .range(offset, offset + self.supabase_batch_size - 1) \
                .execute()
            
            if result.data:
                for row in result.data:
                    channel = ''
                    if row.get('metadata'):
                        channel = row['metadata'].get('channelTitle', '') or \
                                 row['metadata'].get('channel_title', '') or ''
                    
                    all_videos.append({
                        'id': row['id'],
                        'title': row['title'],
                        'channel': channel,
                        'old_confidence': row.get('topic_confidence')
                    })
                
                pbar.update(len(result.data))
            
            offset += self.supabase_batch_size
            time.sleep(self.delay_between_batches)  # Small delay to stay under IOPS
            
        pbar.close()
        
        logger.info(f"\nFetched {len(all_videos):,} videos from Supabase")
        return all_videos
        
    def fetch_embeddings_from_pinecone(self, video_data):
        """Fetch embeddings from Pinecone in larger batches"""
        logger.info("\nFetching embeddings from Pinecone...")
        logger.info(f"Batch size: {self.pinecone_batch_size}")
        
        all_embeddings = []
        all_documents = []
        valid_video_data = []
        missing_count = 0
        
        pbar = tqdm(total=len(video_data), desc="Fetching embeddings", unit="videos")
        
        for i in range(0, len(video_data), self.pinecone_batch_size):
            batch = video_data[i:i+self.pinecone_batch_size]
            batch_ids = [v['id'] for v in batch]
            
            # Fetch both namespaces
            title_response = self.index.fetch(ids=batch_ids, namespace='')
            summary_response = self.index.fetch(ids=batch_ids, namespace='llm-summaries')
            
            # Process batch
            for video in batch:
                vid = video['id']
                
                if vid in title_response.vectors and vid in summary_response.vectors:
                    title_emb = np.array(title_response.vectors[vid].values)
                    summary_emb = np.array(summary_response.vectors[vid].values)
                    
                    # Weighted average
                    combined = (self.title_weight * title_emb + 
                               self.summary_weight * summary_emb)
                    
                    all_embeddings.append(combined)
                    all_documents.append(f"{video['title']} - {video['channel']}" 
                                       if video['channel'] else video['title'])
                    valid_video_data.append(video)
                else:
                    missing_count += 1
                    
            pbar.update(len(batch))
            pbar.set_postfix({'missing': missing_count})
            
            # Save checkpoint every 50k
            if len(all_embeddings) > 0 and len(all_embeddings) % 50000 == 0:
                self._save_checkpoint(all_embeddings, all_documents, valid_video_data)
                logger.info(f"\nCheckpoint saved at {len(all_embeddings):,} videos")
                
        pbar.close()
        
        logger.info(f"\nCollected {len(all_embeddings):,} combined embeddings")
        logger.info(f"Missing embeddings: {missing_count:,}")
        
        return np.array(all_embeddings), all_documents, valid_video_data
        
    def _save_checkpoint(self, embeddings, documents, video_data):
        """Save checkpoint"""
        checkpoint = {
            'embeddings': embeddings,
            'documents': documents,
            'video_data': video_data,
            'timestamp': datetime.now().isoformat()
        }
        
        filename = f"bertopic_checkpoint_{len(video_data)}.pkl"
        with open(filename, 'wb') as f:
            pickle.dump(checkpoint, f)
            
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic clustering"""
        logger.info(f"\nStarting BERTopic clustering on {len(documents):,} documents...")
        logger.info("This will take 10-30 minutes depending on your CPU...")
        
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=10,
            max_df=0.95,
            ngram_range=(1, 3)
        )
        
        topic_model = BERTopic(
            min_topic_size=50,
            nr_topics="auto",
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=True
        )
        
        start_time = datetime.now()
        topics, probs = topic_model.fit_transform(documents, embeddings)
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"\nBERTopic complete in {duration/60:.1f} minutes")
        logger.info(f"Found {len(set(topics)) - 1} topics (excluding outliers)")
        logger.info(f"Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        # Show topic distribution
        topic_counts = {}
        for t in topics:
            topic_counts[t] = topic_counts.get(t, 0) + 1
        
        sorted_topics = sorted(topic_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        logger.info("\nTop 10 topics by size:")
        for topic_id, count in sorted_topics:
            if topic_id != -1:
                logger.info(f"  Topic {topic_id}: {count:,} videos")
        
        return topic_model, topics, probs
        
    def create_hierarchical_topics(self, topic_model, embeddings):
        """Create 3-tier hierarchy"""
        logger.info("\nCreating hierarchical topic structure...")
        
        logger.info("Level 1: Reducing to ~15 domains...")
        topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
        
        logger.info("Level 2: Reducing to ~40 categories...")
        topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
        
        topics_l3 = topic_model.topics_
        
        logger.info(f"Hierarchy created:")
        logger.info(f"  Level 1: {len(set(topics_l1)) - 1} domains")
        logger.info(f"  Level 2: {len(set(topics_l2)) - 1} categories")
        logger.info(f"  Level 3: {len(set(topics_l3)) - 1} micro-topics")
        
        return topics_l1, topics_l2, topics_l3
        
    def save_results(self, video_data, topics, probs, topics_l1, topics_l2, topics_l3, topic_model):
        """Save all results"""
        logger.info("\nSaving results...")
        
        # Prepare classification data
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
                    'outlier_rate': (topics == -1).sum() / len(topics),
                    'num_topics': len(set(topics)) - 1
                },
                'classifications': results
            }, f)
        
        # Save topic model
        topic_model.save("bertopic_model_combined")
        
        # Save topic info
        topic_info = topic_model.get_topic_info()
        topic_info.to_csv("topic_info_combined.csv")
        
        # Save topic keywords
        topic_keywords = {}
        for topic_id in set(topics):
            if topic_id != -1:
                topic_keywords[str(topic_id)] = topic_model.get_topic(topic_id)
        
        with open("topic_keywords.json", 'w') as f:
            json.dump(topic_keywords, f, indent=2)
        
        return output_file
        
    def run(self):
        """Main execution"""
        self.connect()
        
        try:
            # Step 1: Fetch all video data (uses Supabase IOPS)
            start_time = datetime.now()
            video_data = self.fetch_all_video_data()
            supabase_time = (datetime.now() - start_time).total_seconds()
            logger.info(f"Supabase fetch completed in {supabase_time/60:.1f} minutes")
            
            # Step 2: Fetch embeddings (uses Pinecone, no Supabase IOPS)
            embeddings, documents, valid_video_data = self.fetch_embeddings_from_pinecone(video_data)
            
            # Step 3: Run BERTopic (CPU only, no IOPS)
            topic_model, topics, probs = self.run_bertopic(embeddings, documents)
            
            # Step 4: Create hierarchy
            topics_l1, topics_l2, topics_l3 = self.create_hierarchical_topics(topic_model, embeddings)
            
            # Step 5: Save results
            output_file = self.save_results(
                valid_video_data, topics, probs,
                topics_l1, topics_l2, topics_l3,
                topic_model
            )
            
            total_time = (datetime.now() - start_time).total_seconds()
            
            logger.info(f"\n{'='*60}")
            logger.info("✅ BERTopic Classification Complete!")
            logger.info(f"{'='*60}")
            logger.info(f"\nTotal time: {total_time/60:.1f} minutes")
            logger.info(f"Results saved to: {output_file}")
            logger.info(f"\nTo update the database, run:")
            logger.info(f"  node workers/topic-update-worker.js {output_file}")
            logger.info(f"\nStatistics:")
            logger.info(f"  - Total videos: {len(valid_video_data):,}")
            logger.info(f"  - Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
            logger.info(f"  - Number of topics: {len(set(topics)) - 1}")
            
        except Exception as e:
            logger.error(f"Error: {e}")
            raise
            

if __name__ == "__main__":
    print("\n" + "="*60)
    print("Balanced BERTopic Classification (500 IOPS Limit)")
    print("="*60)
    print("\nOptimized for speed while respecting IOPS limits:")
    print("  - Supabase: 1000-row batches with 200ms delays")
    print("  - Target: ~300-400 IOPS (safe margin under 500)")
    print("  - Pinecone: 500-id batches (no IOPS impact)")
    print("  - Estimated time: 30-45 minutes for 180k videos")
    print("="*60 + "\n")
    
    generator = BalancedBERTopicGenerator(
        title_weight=0.3,
        summary_weight=0.7
    )
    
    try:
        generator.run()
    except KeyboardInterrupt:
        print("\n\nProcess interrupted by user")
    except Exception as e:
        logger.error(f"\nError: {e}")
        import traceback
        traceback.print_exc()
