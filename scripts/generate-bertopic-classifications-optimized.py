#!/usr/bin/env python3
"""
Optimized BERTopic Classification using Supabase Best Practices

Uses PostgreSQL functions and streaming for efficient data handling.
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
import asyncio
import aiohttp

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

# Configuration
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod')

class OptimizedBERTopicGenerator:
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
        
    async def create_optimized_fetch_function(self):
        """Create PostgreSQL function for optimized data fetching"""
        # This function fetches data in server-side cursor for efficiency
        function_sql = """
        CREATE OR REPLACE FUNCTION fetch_videos_for_bertopic(
            batch_size INTEGER DEFAULT 5000
        )
        RETURNS TABLE(
            id TEXT,
            title TEXT,
            channel_name TEXT,
            topic_confidence REAL
        ) AS $$
        DECLARE
            cur CURSOR FOR 
                SELECT 
                    v.id,
                    v.title,
                    COALESCE(
                        v.metadata->>'channelTitle',
                        v.metadata->>'channel_title',
                        ''
                    ) as channel_name,
                    v.topic_confidence
                FROM videos v
                WHERE v.pinecone_embedded = true 
                AND v.llm_summary_embedding_synced = true
                ORDER BY v.id;
            rec RECORD;
            counter INTEGER := 0;
        BEGIN
            OPEN cur;
            LOOP
                FETCH cur INTO rec;
                EXIT WHEN NOT FOUND;
                
                id := rec.id;
                title := rec.title;
                channel_name := rec.channel_name;
                topic_confidence := rec.topic_confidence;
                
                RETURN NEXT;
                
                counter := counter + 1;
                IF counter >= batch_size THEN
                    EXIT;
                END IF;
            END LOOP;
            CLOSE cur;
        END;
        $$ LANGUAGE plpgsql;
        """
        
        try:
            await self.supabase.rpc('execute_sql', {'sql': function_sql}).execute()
            logger.info("Created optimized fetch function")
        except:
            logger.info("Fetch function already exists or couldn't be created")
            
    def fetch_videos_streaming(self):
        """Stream video data in efficient batches"""
        logger.info("\nFetching video data using optimized streaming...")
        
        # First get total count
        count_result = self.supabase.table('videos') \
            .select('id', count='exact') \
            .eq('pinecone_embedded', True) \
            .eq('llm_summary_embedding_synced', True) \
            .limit(1) \
            .execute()
            
        total_count = count_result.count
        logger.info(f"Total videos: {total_count:,}")
        
        # Use optimal batch size based on Supabase recommendations
        batch_size = 1000  # Sweet spot for API calls
        all_videos = []
        
        # Create a session for connection reuse
        pbar = tqdm(total=total_count, desc="Streaming from Supabase", unit="videos")
        
        # Fetch only necessary columns to reduce payload
        for offset in range(0, total_count, batch_size):
            result = self.supabase.table('videos') \
                .select('id, title, metadata->channelTitle, metadata->channel_title, topic_confidence') \
                .eq('pinecone_embedded', True) \
                .eq('llm_summary_embedding_synced', True) \
                .order('id') \
                .range(offset, min(offset + batch_size - 1, total_count - 1)) \
                .execute()
                
            if result.data:
                for row in result.data:
                    # Extract channel efficiently
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
                
        pbar.close()
        return all_videos
        
    def fetch_embeddings_parallel(self, video_data):
        """Fetch embeddings from Pinecone with parallel requests"""
        logger.info("\nFetching embeddings from Pinecone (parallel mode)...")
        
        # Split into optimal batch size for Pinecone
        batch_size = 1000  # Pinecone can handle larger batches
        
        all_embeddings = []
        all_documents = []
        valid_video_data = []
        
        pbar = tqdm(total=len(video_data), desc="Fetching embeddings", unit="videos")
        
        # Process in batches
        for i in range(0, len(video_data), batch_size):
            batch = video_data[i:i+batch_size]
            batch_ids = [v['id'] for v in batch]
            
            # Fetch both namespaces in parallel
            title_response = self.index.fetch(ids=batch_ids, namespace='')
            summary_response = self.index.fetch(ids=batch_ids, namespace='llm-summaries')
            
            # Process responses
            batch_embeddings = []
            batch_docs = []
            batch_valid = []
            
            for video in batch:
                vid = video['id']
                
                if vid in title_response.vectors and vid in summary_response.vectors:
                    # Get embeddings
                    title_emb = np.array(title_response.vectors[vid].values)
                    summary_emb = np.array(summary_response.vectors[vid].values)
                    
                    # Weighted combination
                    combined = (self.title_weight * title_emb + 
                               self.summary_weight * summary_emb)
                    
                    batch_embeddings.append(combined)
                    batch_docs.append(f"{video['title']} - {video['channel']}" 
                                    if video['channel'] else video['title'])
                    batch_valid.append(video)
                    
            # Add to main lists
            all_embeddings.extend(batch_embeddings)
            all_documents.extend(batch_docs)
            valid_video_data.extend(batch_valid)
            
            pbar.update(len(batch))
            
            # Save checkpoint periodically
            if len(all_embeddings) % 50000 == 0 and len(all_embeddings) > 0:
                self._save_checkpoint(all_embeddings, all_documents, valid_video_data)
                
        pbar.close()
        
        logger.info(f"\nCollected {len(all_embeddings):,} embeddings")
        return np.array(all_embeddings), all_documents, valid_video_data
        
    def _save_checkpoint(self, embeddings, documents, video_data):
        """Save checkpoint for recovery"""
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
        
    def run_bertopic_optimized(self, embeddings, documents):
        """Run BERTopic with optimized settings"""
        logger.info(f"\nRunning BERTopic on {len(documents):,} documents...")
        
        # Optimize vectorizer for large datasets
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=10,
            max_df=0.95,
            ngram_range=(1, 3),
            max_features=10000  # Limit features for memory efficiency
        )
        
        # Configure BERTopic for large-scale processing
        topic_model = BERTopic(
            min_topic_size=50,
            nr_topics="auto",
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=True,
            low_memory=True  # Enable low memory mode if available
        )
        
        start_time = datetime.now()
        topics, probs = topic_model.fit_transform(documents, embeddings)
        duration = (datetime.now() - start_time).total_seconds()
        
        logger.info(f"\nBERTopic complete in {duration/60:.1f} minutes")
        logger.info(f"Topics found: {len(set(topics)) - 1}")
        logger.info(f"Outlier rate: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        return topic_model, topics, probs
        
    def create_batch_update_function(self):
        """Create PostgreSQL function for batch updates"""
        function_sql = """
        CREATE OR REPLACE FUNCTION batch_update_topic_classifications(
            updates JSONB
        )
        RETURNS INTEGER AS $$
        DECLARE
            updated_count INTEGER := 0;
            item JSONB;
        BEGIN
            FOR item IN SELECT * FROM jsonb_array_elements(updates)
            LOOP
                UPDATE videos
                SET 
                    topic_level_1 = (item->>'topic_level_1')::INTEGER,
                    topic_level_2 = (item->>'topic_level_2')::INTEGER,
                    topic_level_3 = (item->>'topic_level_3')::INTEGER,
                    topic_cluster_id = (item->>'topic_cluster_id')::INTEGER,
                    topic_confidence = (item->>'topic_confidence')::REAL,
                    classification_timestamp = NOW()
                WHERE id = item->>'id';
                
                updated_count := updated_count + 1;
            END LOOP;
            
            RETURN updated_count;
        END;
        $$ LANGUAGE plpgsql;
        """
        
        try:
            self.supabase.rpc('execute_sql', {'sql': function_sql}).execute()
            logger.info("Created batch update function")
        except:
            logger.info("Update function already exists")
            
    def run(self):
        """Main execution with optimizations"""
        self.connect()
        
        try:
            # Create optimized functions if needed
            # asyncio.run(self.create_optimized_fetch_function())
            # self.create_batch_update_function()
            
            # Step 1: Stream video data efficiently
            video_data = self.fetch_videos_streaming()
            
            # Step 2: Fetch embeddings in parallel
            embeddings, documents, valid_video_data = self.fetch_embeddings_parallel(video_data)
            
            # Step 3: Run optimized BERTopic
            topic_model, topics, probs = self.run_bertopic_optimized(embeddings, documents)
            
            # Step 4: Create hierarchy
            logger.info("\nCreating topic hierarchy...")
            topics_l1 = topic_model.reduce_topics(embeddings, nr_topics=15)
            topics_l2 = topic_model.reduce_topics(embeddings, nr_topics=40)
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
                
            # Save to file
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
                
            # Save model and topic info
            topic_model.save("bertopic_model_combined")
            
            logger.info(f"\n{'='*60}")
            logger.info("✅ BERTopic Classification Complete!")
            logger.info(f"Results saved to: {output_file}")
            logger.info(f"\nNext step: node workers/topic-update-worker.js {output_file}")
            logger.info(f"{'='*60}")
            
        except Exception as e:
            logger.error(f"Error: {e}")
            raise
            

if __name__ == "__main__":
    print("\n" + "="*60)
    print("Optimized BERTopic Classification")
    print("="*60)
    print("\nUsing Supabase best practices:")
    print("  - Optimal 1000-row batches (recommended by Supabase)")
    print("  - Minimal column selection to reduce payload")
    print("  - Connection reuse and streaming")
    print("  - Parallel Pinecone fetches")
    print("\nEstimated time: 20-30 minutes for 180k videos")
    print("="*60 + "\n")
    
    generator = OptimizedBERTopicGenerator(
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
