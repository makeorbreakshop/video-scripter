#!/usr/bin/env python3
"""
Ultra-Safe BERTopic Classification - Minimal IOPS Usage

This version uses ID-based fetching to minimize database page reads.
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

class UltraSafeBERTopicGenerator:
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
        
    def fetch_video_ids_only(self):
        """Fetch ONLY IDs to minimize IOPS - single column, no joins"""
        logger.info("\nFetching video IDs (minimal IOPS approach)...")
        
        # Step 1: Get total count (1 query, minimal IOPS)
        count_result = self.supabase.table('videos') \
            .select('id', count='exact') \
            .eq('pinecone_embedded', True) \
            .eq('llm_summary_embedding_synced', True) \
            .limit(1) \
            .execute()
            
        total_count = count_result.count
        logger.info(f"Total videos to process: {total_count:,}")
        
        # Step 2: Fetch IDs in very small batches to minimize page reads
        all_ids = []
        batch_size = 100  # Small batch to minimize pages read
        offset = 0
        
        pbar = tqdm(total=total_count, desc="Fetching IDs", unit="ids")
        
        while offset < total_count:
            # Fetch only ID column - minimal data transfer
            result = self.supabase.table('videos') \
                .select('id') \
                .eq('pinecone_embedded', True) \
                .eq('llm_summary_embedding_synced', True) \
                .order('id') \
                .range(offset, offset + batch_size - 1) \
                .execute()
                
            if result.data:
                all_ids.extend([row['id'] for row in result.data])
                pbar.update(len(result.data))
                
            offset += batch_size
            time.sleep(0.5)  # 500ms delay between batches
            
        pbar.close()
        logger.info(f"Fetched {len(all_ids):,} video IDs")
        return all_ids
        
    def fetch_video_details_by_ids(self, video_ids, batch_size=50):
        """Fetch video details using ID list - more efficient than filtering"""
        logger.info("\nFetching video details by IDs...")
        
        all_videos = []
        pbar = tqdm(total=len(video_ids), desc="Fetching details", unit="videos")
        
        for i in range(0, len(video_ids), batch_size):
            batch_ids = video_ids[i:i+batch_size]
            
            # Use IN query which is more efficient than boolean filters
            result = self.supabase.table('videos') \
                .select('id, title, metadata->channelTitle, metadata->channel_title, topic_confidence') \
                .in_('id', batch_ids) \
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
                    
            pbar.update(len(batch_ids))
            time.sleep(0.5)  # Delay to keep IOPS low
            
        pbar.close()
        return all_videos
        
    def fetch_embeddings_from_pinecone(self, video_data):
        """Fetch embeddings from Pinecone"""
        logger.info("\nFetching embeddings from Pinecone...")
        
        batch_size = 100
        all_embeddings = []
        all_documents = []
        valid_video_data = []
        
        stats = {
            'both': 0,
            'title_only': 0,
            'summary_only': 0,
            'neither': 0
        }
        
        pbar = tqdm(total=len(video_data), desc="Fetching embeddings", unit="videos")
        
        for i in range(0, len(video_data), batch_size):
            batch = video_data[i:i+batch_size]
            batch_ids = [v['id'] for v in batch]
            
            # Fetch from both namespaces
            title_response = self.index.fetch(ids=batch_ids, namespace='')
            time.sleep(0.2)  # Small delay
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
                    
            pbar.update(len(batch))
            pbar.set_postfix(stats)
            time.sleep(0.3)  # Delay between Pinecone batches
            
        pbar.close()
        
        logger.info("\nEmbedding Statistics:")
        logger.info(f"  Both embeddings: {stats['both']:,}")
        logger.info(f"  Title only: {stats['title_only']:,}")
        logger.info(f"  Summary only: {stats['summary_only']:,}")
        logger.info(f"  Neither: {stats['neither']:,}")
        
        return np.array(all_embeddings), all_documents, valid_video_data
        
    def run_bertopic(self, embeddings, documents):
        """Run BERTopic clustering"""
        logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
        
        # Adjust for dataset size
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
            # Step 1: Fetch IDs only (minimal IOPS)
            video_ids = self.fetch_video_ids_only()
            
            # Step 2: Fetch details using ID batches (efficient)
            video_data = self.fetch_video_details_by_ids(video_ids)
            
            # Step 3: Get embeddings from Pinecone
            embeddings, documents, valid_video_data = self.fetch_embeddings_from_pinecone(video_data)
            
            logger.info(f"\nReady to cluster {len(valid_video_data):,} videos")
            
            # Step 4: Run BERTopic
            topic_model, topics, probs = self.run_bertopic(embeddings, documents)
            
            # Step 5: Create hierarchy
            logger.info("\nCreating topic hierarchy...")
            try:
                topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
                topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
            except Exception as e:
                logger.warning(f"Could not create full hierarchy: {e}")
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
                
            # Save model
            topic_model.save("bertopic_model_combined")
            
            logger.info(f"\n{'='*60}")
            logger.info("✅ BERTopic Classification Complete!")
            logger.info(f"Results saved to: {output_file}")
            logger.info(f"\nTo update database: node workers/topic-update-worker.js {output_file}")
            logger.info(f"{'='*60}")
            
        except Exception as e:
            logger.error(f"Error: {e}")
            raise
            

if __name__ == "__main__":
    print("\n" + "="*60)
    print("Ultra-Safe BERTopic Classification (Minimal IOPS)")
    print("="*60)
    print("\nThis version minimizes IOPS by:")
    print("  - Fetching only IDs first (single column)")
    print("  - Using ID-based queries instead of boolean filters")
    print("  - Small batch sizes with delays")
    print("  - No complex WHERE clauses that require table scans")
    print("="*60 + "\n")
    
    generator = UltraSafeBERTopicGenerator(
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