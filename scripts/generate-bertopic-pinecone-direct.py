#!/usr/bin/env python3
"""
BERTopic Classification - Direct Pinecone Check

This version completely ignores Supabase embedding flags and checks
Pinecone directly for all videos with LLM summaries.
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

# Configuration
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod')

class PineconeDirectBERTopicGenerator:
    def __init__(self, title_weight=0.3, summary_weight=0.7):
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
        
    def fetch_all_videos_with_summaries(self):
        """Fetch ALL videos that have LLM summaries, regardless of embedding flags"""
        logger.info("\nFetching ALL videos with LLM summaries (ignoring embedding flags)...")
        
        # Get count of videos with LLM summaries
        count_result = self.supabase.table('videos') \
            .select('id', count='exact') \
            .not_.is_('llm_summary', None) \
            .limit(1) \
            .execute()
            
        total_count = count_result.count
        logger.info(f"Total videos with LLM summaries: {total_count:,}")
        
        # Fetch all videos with summaries in batches
        batch_size = 500  # Moderate batch size
        all_videos = []
        offset = 0
        
        pbar = tqdm(total=total_count, desc="Fetching videos with summaries", unit="videos")
        
        while offset < total_count:
            result = self.supabase.table('videos') \
                .select('id, title, metadata->channelTitle, metadata->channel_title, topic_confidence') \
                .not_.is_('llm_summary', None) \
                .order('id') \
                .range(offset, offset + batch_size - 1) \
                .execute()
                
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
                    
                pbar.update(len(result.data))
                
            offset += batch_size
            time.sleep(0.2)  # Small delay to be gentle on IOPS
            
        pbar.close()
        logger.info(f"Fetched {len(all_videos):,} videos with LLM summaries")
        return all_videos
        
    def verify_and_fetch_embeddings(self, video_data):
        """Check Pinecone directly for embeddings"""
        logger.info("\nChecking Pinecone for actual embeddings...")
        
        batch_size = 500  # Pinecone can handle larger batches
        all_embeddings = []
        all_documents = []
        valid_video_data = []
        
        stats = {
            'both': 0,
            'title_only': 0,
            'summary_only': 0,
            'neither': 0,
            'processed': 0
        }
        
        pbar = tqdm(total=len(video_data), desc="Verifying embeddings in Pinecone", unit="videos")
        
        for i in range(0, len(video_data), batch_size):
            batch = video_data[i:i+batch_size]
            batch_ids = [v['id'] for v in batch]
            
            # Fetch from both namespaces
            title_response = self.index.fetch(ids=batch_ids, namespace='')
            summary_response = self.index.fetch(ids=batch_ids, namespace='llm-summaries')
            
            for video in batch:
                vid = video['id']
                has_title = vid in title_response.vectors
                has_summary = vid in summary_response.vectors
                
                if has_title and has_summary:
                    # Both embeddings exist!
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
                    
                stats['processed'] += 1
                
            pbar.update(len(batch))
            pbar.set_postfix({
                'both': stats['both'],
                'title_only': stats['title_only']
            })
            
            # Save checkpoint every 50k
            if stats['both'] > 0 and stats['both'] % 50000 == 0:
                self._save_checkpoint(all_embeddings, all_documents, valid_video_data, stats)
                
            time.sleep(0.1)  # Small delay between Pinecone calls
            
        pbar.close()
        
        logger.info("\n" + "="*60)
        logger.info("FINAL Embedding Statistics:")
        logger.info(f"  Total videos checked: {stats['processed']:,}")
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
        
        filename = f"bertopic_checkpoint_direct_{len(video_data)}.pkl"
        with open(filename, 'wb') as f:
            pickle.dump(checkpoint, f)
        logger.info(f"\nCheckpoint saved: {filename} ({len(video_data):,} videos)")
        
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic clustering"""
        logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
        
        # Adjust for actual dataset size
        min_docs = 5 if len(documents) < 100000 else 10
        max_df = 0.95 if len(documents) > 10000 else 0.9
        
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=min_docs,
            max_df=max_df,
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
            # Step 1: Get ALL videos with LLM summaries
            logger.info("="*60)
            logger.info("IGNORING Supabase embedding flags!")
            logger.info("Checking Pinecone directly for all videos with summaries")
            logger.info("="*60)
            
            video_data = self.fetch_all_videos_with_summaries()
            
            # Step 2: Check what's ACTUALLY in Pinecone
            embeddings, documents, valid_video_data = self.verify_and_fetch_embeddings(video_data)
            
            if len(valid_video_data) < 1000:
                logger.error(f"Only found {len(valid_video_data)} videos with both embeddings!")
                logger.error("This is too few for meaningful clustering.")
                return
                
            # Step 3: Run BERTopic
            topic_model, topics, probs = self.run_bertopic(embeddings, documents)
            
            # Step 4: Create hierarchy
            logger.info("\nCreating topic hierarchy...")
            try:
                topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
                logger.info(f"Level 1: {len(set(topics_l1)) - 1} topics")
            except Exception as e:
                logger.warning(f"Could not reduce to 15 topics: {e}")
                topics_l1 = topics
                
            try:
                topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
                logger.info(f"Level 2: {len(set(topics_l2)) - 1} topics")
            except Exception as e:
                logger.warning(f"Could not reduce to 40 topics: {e}")
                topics_l2 = topics
                
            topics_l3 = topics
            
            # Step 5: Save results
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
                
            output_file = f"bertopic_classifications_direct_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(output_file, 'w') as f:
                json.dump({
                    'metadata': {
                        'total_videos': len(results),
                        'timestamp': datetime.now().isoformat(),
                        'title_weight': self.title_weight,
                        'summary_weight': self.summary_weight,
                        'outlier_rate': (topics == -1).sum() / len(topics),
                        'method': 'pinecone_direct'
                    },
                    'classifications': results
                }, f)
                
            # Save model
            topic_model.save("bertopic_model_combined_direct")
            
            logger.info(f"\n{'='*60}")
            logger.info("✅ BERTopic Classification Complete!")
            logger.info(f"Processed {len(results):,} videos with both embeddings")
            logger.info(f"Results saved to: {output_file}")
            logger.info(f"\nTo update database: node workers/topic-update-worker.js {output_file}")
            logger.info(f"{'='*60}")
            
        except Exception as e:
            logger.error(f"Error: {e}")
            raise
            

if __name__ == "__main__":
    print("\n" + "="*60)
    print("BERTopic Classification - Pinecone Direct")
    print("="*60)
    print("\nThis version:")
    print("  - IGNORES Supabase embedding flags completely")
    print("  - Fetches ALL videos with LLM summaries (~179K)")
    print("  - Checks Pinecone directly for actual embeddings")
    print("  - Processes whatever has both embeddings")
    print("="*60 + "\n")
    
    generator = PineconeDirectBERTopicGenerator(
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