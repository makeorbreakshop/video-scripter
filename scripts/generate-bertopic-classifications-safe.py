#!/usr/bin/env python3
"""
IOPS-SAFE BERTopic Classification Generator

This version prioritizes Supabase IOPS limits over speed.
Expects ~700 IOPS limit, targets 100-200 IOPS usage.
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

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise ValueError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

# Pinecone setup
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod')

class IOPSSafeBERTopicGenerator:
    def __init__(self, title_weight=0.3, summary_weight=0.7):
        # IOPS-safe configuration
        self.supabase_batch_size = 50  # Very small batches for Supabase
        self.pinecone_batch_size = 100  # Pinecone can handle more
        self.delay_between_supabase_calls = 3  # 3 seconds between Supabase calls
        self.delay_between_pinecone_calls = 0.5  # 0.5 seconds between Pinecone calls
        
        self.title_weight = title_weight
        self.summary_weight = summary_weight
        self.supabase = None
        self.pc = None
        self.index = None
        
        # IOPS tracking
        self.iops_history = []
        self.iops_window = 60  # 60 second window
        
    def track_iops(self, operation_type, count):
        """Track IOPS usage"""
        now = time.time()
        self.iops_history.append({
            'time': now,
            'type': operation_type,
            'count': count
        })
        
        # Clean old entries
        cutoff = now - self.iops_window
        self.iops_history = [op for op in self.iops_history if op['time'] > cutoff]
        
        # Calculate current IOPS
        total_ops = sum(op['count'] for op in self.iops_history)
        current_iops = total_ops / self.iops_window
        
        return current_iops
        
    def wait_for_safe_iops(self, required_ops):
        """Wait until it's safe to perform operations"""
        while True:
            current_iops = self.track_iops('check', 0)
            if current_iops + required_ops < 200:  # Stay well under 700 limit
                break
            
            wait_time = 5
            logger.warning(f"Current IOPS: {current_iops:.1f}, waiting {wait_time}s...")
            time.sleep(wait_time)
        
    def connect(self):
        """Initialize connections"""
        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        self.pc = Pinecone(api_key=PINECONE_API_KEY)
        self.index = self.pc.Index(PINECONE_INDEX_NAME)
        logger.info("Connected to Supabase and Pinecone")
        
    def fetch_video_ids_only(self):
        """Fetch just video IDs to minimize IOPS"""
        logger.info("\nFetching video IDs (IOPS-safe mode)...")
        
        all_ids = []
        offset = 0
        
        # First, get total count
        self.wait_for_safe_iops(1)
        count_result = self.supabase.table('videos') \
            .select('id', count='exact') \
            .eq('pinecone_embedded', True) \
            .eq('llm_summary_embedding_synced', True) \
            .limit(1) \
            .execute()
        
        total_count = count_result.count
        logger.info(f"Total videos to process: {total_count:,}")
        
        # Progress bar for ID fetching
        pbar = tqdm(total=total_count, desc="Fetching video IDs", unit="videos")
        
        while offset < total_count:
            # Wait for safe IOPS window
            self.wait_for_safe_iops(1)
            
            # Fetch batch of IDs
            result = self.supabase.table('videos') \
                .select('id') \
                .eq('pinecone_embedded', True) \
                .eq('llm_summary_embedding_synced', True) \
                .order('id') \
                .range(offset, offset + self.supabase_batch_size - 1) \
                .execute()
                
            self.track_iops('supabase_read', 1)
            
            if result.data:
                all_ids.extend([row['id'] for row in result.data])
                pbar.update(len(result.data))
            
            offset += self.supabase_batch_size
            time.sleep(self.delay_between_supabase_calls)
            
        pbar.close()
        
        logger.info(f"\nFetched {len(all_ids):,} video IDs")
        return all_ids
        
    def fetch_video_details(self, video_ids):
        """Fetch video details in small batches"""
        logger.info("\nFetching video details...")
        
        all_videos = []
        pbar = tqdm(total=len(video_ids), desc="Fetching details", unit="videos")
        
        for i in range(0, len(video_ids), 20):  # Very small batches
            batch_ids = video_ids[i:i+20]
            
            self.wait_for_safe_iops(1)
            
            result = self.supabase.table('videos') \
                .select('id, title, metadata, topic_confidence') \
                .in_('id', batch_ids) \
                .execute()
                
            self.track_iops('supabase_read', 1)
            
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
            
            time.sleep(1)  # Brief pause between batches
            
        pbar.close()
        return all_videos
        
    def fetch_embeddings_from_pinecone(self, video_data):
        """Fetch embeddings from Pinecone"""
        logger.info("\nFetching embeddings from Pinecone...")
        
        all_embeddings = []
        all_documents = []
        valid_video_data = []
        
        pbar = tqdm(total=len(video_data), desc="Fetching embeddings", unit="videos")
        
        for i in range(0, len(video_data), self.pinecone_batch_size):
            batch = video_data[i:i+self.pinecone_batch_size]
            batch_ids = [v['id'] for v in batch]
            
            # Fetch title embeddings
            title_response = self.index.fetch(ids=batch_ids, namespace='')
            
            # Small delay
            time.sleep(self.delay_between_pinecone_calls)
            
            # Fetch summary embeddings
            summary_response = self.index.fetch(ids=batch_ids, namespace='llm-summaries')
            
            # Combine embeddings
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
                    
            pbar.update(len(batch))
            
            # Checkpoint every 10k videos
            if len(all_embeddings) > 0 and len(all_embeddings) % 10000 == 0:
                self._save_checkpoint(all_embeddings, all_documents, valid_video_data)
                
        pbar.close()
        
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
            
        logger.info(f"Checkpoint saved: {filename}")
        
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic clustering"""
        logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
        logger.info("This may take 10-30 minutes...")
        
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
        
        logger.info(f"\nBERTopic complete in {duration:.1f} seconds")
        logger.info(f"Found {len(set(topics)) - 1} topics")
        logger.info(f"Outliers: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        return topic_model, topics, probs
        
    def run(self):
        """Main execution"""
        self.connect()
        
        try:
            # Step 1: Get video IDs (minimal IOPS)
            video_ids = self.fetch_video_ids_only()
            
            # Step 2: Get video details (controlled IOPS)
            video_data = self.fetch_video_details(video_ids)
            
            # Step 3: Get embeddings from Pinecone (no Supabase IOPS)
            embeddings, documents, valid_video_data = self.fetch_embeddings_from_pinecone(video_data)
            
            logger.info(f"\nCollected {len(embeddings):,} videos with both embeddings")
            
            # Step 4: Run BERTopic (no database IOPS)
            topic_model, topics, probs = self.run_bertopic(embeddings, documents)
            
            # Step 5: Create hierarchical structure
            logger.info("\nCreating hierarchical structure...")
            topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
            topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
            topics_l3 = topics
            
            # Step 6: Save results
            results = []
            for i, video in enumerate(valid_video_data):
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
                
            logger.info(f"\n{'='*60}")
            logger.info("✅ Complete! Results saved to:")
            logger.info(f"  {output_file}")
            logger.info(f"\nRun the worker to update database:")
            logger.info(f"  node workers/topic-update-worker.js {output_file}")
            logger.info(f"{'='*60}")
            
            # Save topic model
            topic_model.save("bertopic_model_combined")
            
        finally:
            pass
            

if __name__ == "__main__":
    print("\n" + "="*60)
    print("IOPS-SAFE BERTopic Classification")
    print("="*60)
    print("\n⚠️  This version prioritizes Supabase IOPS safety")
    print("  - Target: 100-200 IOPS (well under 700 limit)")
    print("  - Small batches with delays")
    print("  - Automatic IOPS monitoring")
    print("  - Estimated time: 2-3 hours for 180k videos")
    print("="*60 + "\n")
    
    generator = IOPSSafeBERTopicGenerator(
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
