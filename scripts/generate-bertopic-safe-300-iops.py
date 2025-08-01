#!/usr/bin/env python3
"""
BERTopic Classification - Safe 300 IOPS Max

This version:
- Targets 250-300 IOPS (safe margin under 500)
- Finds ALL videos with LLM summaries
- Implements IOPS monitoring and throttling
- Connection retry logic to prevent timeouts
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
from httpx import TimeoutException, RemoteProtocolError

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod')

class Safe300IOPSGenerator:
    def __init__(self, title_weight=0.3, summary_weight=0.7):
        self.title_weight = title_weight
        self.summary_weight = summary_weight
        self.supabase = None
        self.pc = None
        self.index = None
        
        # Safe settings targeting 250-300 IOPS
        self.id_batch_size = 200  # Smaller than moderate
        self.detail_batch_size = 100  # Smaller batches
        self.pinecone_batch_size = 500  # Pinecone doesn't affect IOPS
        self.delay_between_queries = 0.3  # 300ms - balanced
        
        # IOPS tracking
        self.query_times = []
        self.iops_window = 10  # Track last 10 seconds
        
    def connect(self):
        """Initialize connections"""
        self.supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        self.pc = Pinecone(api_key=PINECONE_API_KEY)
        self.index = self.pc.Index(PINECONE_INDEX_NAME)
        logger.info("Connected to Supabase and Pinecone")
        
    def track_query(self):
        """Track query for IOPS monitoring"""
        now = time.time()
        self.query_times.append(now)
        # Remove old entries
        cutoff = now - self.iops_window
        self.query_times = [t for t in self.query_times if t > cutoff]
        
        # Calculate current IOPS
        current_iops = len(self.query_times) * (60 / self.iops_window)
        return current_iops
        
    def wait_if_needed(self):
        """Dynamic throttling based on current IOPS"""
        current_iops = self.track_query()
        
        if current_iops > 280:  # Getting close to 300
            # Increase delay
            extra_delay = (current_iops - 280) * 0.01  # Add 10ms per IOPS over 280
            time.sleep(self.delay_between_queries + extra_delay)
            logger.debug(f"IOPS: {current_iops:.0f} - Added {extra_delay:.3f}s delay")
        else:
            time.sleep(self.delay_between_queries)
            
    def execute_with_retry(self, query_func, max_retries=3):
        """Execute query with retry logic"""
        for attempt in range(max_retries):
            try:
                return query_func()
            except (TimeoutException, RemoteProtocolError) as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Connection error (attempt {attempt + 1}): {e}")
                    time.sleep(2 ** attempt)  # Exponential backoff
                    self.connect()  # Reconnect
                else:
                    raise
                    
    def fetch_all_video_ids_with_summaries(self):
        """Fetch IDs of ALL videos with LLM summaries"""
        logger.info("\nFetching IDs of ALL videos with LLM summaries...")
        logger.info("Target IOPS: 250-300 (safe margin under 500)")
        
        # Get total count
        count_query = lambda: self.supabase.table('videos') \
            .select('id', count='exact') \
            .not_.is_('llm_summary', None) \
            .limit(1) \
            .execute()
            
        count_result = self.execute_with_retry(count_query)
        total_count = count_result.count
        
        logger.info(f"Total videos with LLM summaries: {total_count:,}")
        logger.info(f"Batch size: {self.id_batch_size} IDs per query")
        est_time = (total_count / self.id_batch_size * self.delay_between_queries / 60)
        logger.info(f"Estimated time: {est_time:.1f} minutes")
        
        # Fetch IDs
        all_ids = []
        offset = 0
        
        pbar = tqdm(total=total_count, desc="Fetching video IDs", unit="ids")
        
        while offset < total_count:
            batch_query = lambda: self.supabase.table('videos') \
                .select('id') \
                .not_.is_('llm_summary', None) \
                .order('id') \
                .range(offset, offset + self.id_batch_size - 1) \
                .execute()
                
            result = self.execute_with_retry(batch_query)
            
            if result.data:
                all_ids.extend([row['id'] for row in result.data])
                pbar.update(len(result.data))
                
            offset += self.id_batch_size
            
            # Dynamic throttling
            self.wait_if_needed()
            
            # Show IOPS in progress bar
            current_iops = len(self.query_times) * (60 / self.iops_window)
            pbar.set_postfix({'IOPS': f'{current_iops:.0f}'})
            
        pbar.close()
        logger.info(f"Fetched {len(all_ids):,} video IDs")
        return all_ids
        
    def fetch_video_details_safe(self, video_ids):
        """Fetch video details with IOPS monitoring"""
        logger.info(f"\nFetching details for {len(video_ids):,} videos...")
        
        all_videos = []
        pbar = tqdm(total=len(video_ids), desc="Fetching video details", unit="videos")
        
        # Checkpoint for recovery
        checkpoint_file = "video_details_checkpoint.json"
        processed_count = 0
        
        for i in range(0, len(video_ids), self.detail_batch_size):
            batch_ids = video_ids[i:i+self.detail_batch_size]
            
            detail_query = lambda: self.supabase.table('videos') \
                .select('id, title, metadata->channelTitle, metadata->channel_title, topic_confidence') \
                .in_('id', batch_ids) \
                .execute()
                
            result = self.execute_with_retry(detail_query)
            
            if result.data:
                for row in result.data:
                    channel = ''
                    if 'channelTitle' in row:
                        channel = row['channelTitle'] or ''
                    elif 'channel_title' in row:
                        channel = row['channel_title'] or ''
                        
                    all_videos.append({
                        'id': row['id'],
                        'title': row['title'],
                        'channel': channel,
                        'old_confidence': row.get('topic_confidence')
                    })
                    
            pbar.update(len(batch_ids))
            processed_count += len(batch_ids)
            
            # Save checkpoint every 20k
            if processed_count % 20000 == 0:
                with open(checkpoint_file, 'w') as f:
                    json.dump({
                        'processed': processed_count,
                        'total': len(video_ids),
                        'videos_so_far': len(all_videos)
                    }, f)
                logger.info(f"\nCheckpoint: {processed_count:,}/{len(video_ids):,}")
                    
            # Dynamic throttling
            self.wait_if_needed()
            
            # Show IOPS
            current_iops = len(self.query_times) * (60 / self.iops_window)
            pbar.set_postfix({'IOPS': f'{current_iops:.0f}'})
            
        pbar.close()
        
        # Clean up checkpoint
        if os.path.exists(checkpoint_file):
            os.remove(checkpoint_file)
            
        return all_videos
        
    def check_pinecone_embeddings(self, video_data):
        """Check Pinecone for actual embeddings"""
        logger.info("\nChecking Pinecone for embeddings...")
        
        all_embeddings = []
        all_documents = []
        valid_video_data = []
        
        stats = {
            'both': 0,
            'title_only': 0,
            'summary_only': 0,
            'neither': 0
        }
        
        pbar = tqdm(total=len(video_data), desc="Checking Pinecone", unit="videos")
        
        for i in range(0, len(video_data), self.pinecone_batch_size):
            batch = video_data[i:i+self.pinecone_batch_size]
            batch_ids = [v['id'] for v in batch]
            
            try:
                # Pinecone queries don't affect Supabase IOPS
                title_response = self.index.fetch(ids=batch_ids, namespace='')
                summary_response = self.index.fetch(ids=batch_ids, namespace='llm-summaries')
                
                for video in batch:
                    vid = video['id']
                    has_title = vid in title_response.vectors
                    has_summary = vid in summary_response.vectors
                    
                    if has_title and has_summary:
                        title_emb = np.array(title_response.vectors[vid].values)
                        summary_emb = np.array(summary_response.vectors[vid].values)
                        
                        # Weighted combination
                        combined = (self.title_weight * title_emb + 
                                   self.summary_weight * summary_emb)
                        
                        all_embeddings.append(combined)
                        all_documents.append(f"{video['title']} - {video['channel']}" 
                                           if video['channel'] else video['title'])
                        valid_video_data.append(video)
                        stats['both'] += 1
                        
                    elif has_title:
                        stats['title_only'] += 1
                    elif has_summary:
                        stats['summary_only'] += 1
                    else:
                        stats['neither'] += 1
                        
            except Exception as e:
                logger.warning(f"Pinecone error: {e}")
                
            pbar.update(len(batch))
            pbar.set_postfix(stats)
            
            # Save checkpoint every 25k
            if stats['both'] > 0 and stats['both'] % 25000 == 0:
                self._save_checkpoint(all_embeddings, all_documents, valid_video_data, stats)
                
            time.sleep(0.1)  # Small delay for Pinecone
            
        pbar.close()
        
        logger.info("\n" + "="*60)
        logger.info("Embedding Statistics:")
        logger.info(f"  Total checked: {len(video_data):,}")
        logger.info(f"  Both embeddings: {stats['both']:,} ✅")
        logger.info(f"  Title only: {stats['title_only']:,}")
        logger.info(f"  Summary only: {stats['summary_only']:,}")
        logger.info(f"  Neither: {stats['neither']:,}")
        logger.info("="*60 + "\n")
        
        return np.array(all_embeddings), all_documents, valid_video_data
        
    def _save_checkpoint(self, embeddings, documents, video_data, stats):
        """Save checkpoint"""
        checkpoint = {
            'embeddings': embeddings,
            'documents': documents,
            'video_data': video_data,
            'stats': stats,
            'timestamp': datetime.now().isoformat()
        }
        
        filename = f"bertopic_checkpoint_safe_{len(video_data)}.pkl"
        with open(filename, 'wb') as f:
            pickle.dump(checkpoint, f)
        logger.info(f"\nCheckpoint saved: {filename}")
        
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic clustering"""
        logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
        
        min_docs = 10 if len(documents) > 50000 else 5
        
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=min_docs,
            max_df=0.95,
            ngram_range=(1, 2),
            max_features=10000
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
        logger.info(f"Topics found: {len(set(topics)) - 1}")
        logger.info(f"Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        return topic_model, topics, probs
        
    def run(self):
        """Main execution"""
        self.connect()
        
        try:
            logger.info("="*60)
            logger.info("BERTopic - Safe 300 IOPS Maximum")
            logger.info("Finding ALL videos with LLM summaries")
            logger.info("="*60)
            
            # Step 1: Fetch IDs
            video_ids = self.fetch_all_video_ids_with_summaries()
            
            # Step 2: Fetch details
            video_data = self.fetch_video_details_safe(video_ids)
            
            # Step 3: Check Pinecone
            embeddings, documents, valid_video_data = self.check_pinecone_embeddings(video_data)
            
            if len(valid_video_data) < 1000:
                logger.error(f"Only found {len(valid_video_data)} videos!")
                return
                
            # Step 4: Run BERTopic
            topic_model, topics, probs = self.run_bertopic(embeddings, documents)
            
            # Step 5: Create hierarchy
            logger.info("\nCreating topic hierarchy...")
            try:
                topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
                topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
            except:
                topics_l1 = topics
                topics_l2 = topics
                
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
                
            topic_model.save("bertopic_model_combined")
            
            logger.info(f"\n{'='*60}")
            logger.info("✅ Complete!")
            logger.info(f"Processed {len(results):,} videos")
            logger.info(f"Results: {output_file}")
            logger.info(f"\nNext: node workers/topic-update-worker.js {output_file}")
            logger.info(f"{'='*60}")
            
        except Exception as e:
            logger.error(f"Error: {e}")
            raise
            

if __name__ == "__main__":
    print("\n" + "="*60)
    print("BERTopic - Safe 300 IOPS (ALL Videos)")
    print("="*60)
    print("\nFeatures:")
    print("  - Finds ALL ~179K videos")
    print("  - IOPS monitoring and throttling")
    print("  - Targets 250-300 IOPS (safe margin)")
    print("  - Dynamic delays based on current IOPS")
    print("  - Connection retry logic")
    print("  - Progress checkpoints")
    print("  - Estimated: 60-90 minutes")
    print("="*60 + "\n")
    
    generator = Safe300IOPSGenerator(
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