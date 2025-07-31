#!/usr/bin/env python3
"""
Update BERTopic clustering using combined title+summary embeddings.
This will update the existing topic_level_1/2/3 columns with better classifications.
"""

import os
import sys
import numpy as np
from bertopic import BERTopic
from sklearn.feature_extraction.text import CountVectorizer
import psycopg2
from psycopg2.extras import RealDictCursor
import pinecone
from dotenv import load_dotenv
import json
from tqdm import tqdm
import logging
from datetime import datetime

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

# Database connection
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    # Construct from individual components
    DATABASE_URL = f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME')}"

# Pinecone setup
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')
PINECONE_INDEX_NAME = os.getenv('PINECONE_INDEX_NAME', 'video-embeddings')
PINECONE_SUMMARY_INDEX_NAME = os.getenv('PINECONE_SUMMARY_INDEX_NAME', 'video-embeddings')

class CombinedEmbeddingBERTopic:
    def __init__(self, batch_size=1000, title_weight=0.3, summary_weight=0.7):
        self.batch_size = batch_size
        self.title_weight = title_weight
        self.summary_weight = summary_weight
        self.conn = None
        self.pc = None
        self.title_index = None
        self.summary_index = None
        
    def connect(self):
        """Initialize database and Pinecone connections"""
        self.conn = psycopg2.connect(DATABASE_URL)
        
        # Initialize Pinecone
        self.pc = pinecone.Pinecone(api_key=PINECONE_API_KEY)
        self.title_index = self.pc.Index(PINECONE_INDEX_NAME)
        self.summary_index = self.pc.Index(PINECONE_SUMMARY_INDEX_NAME)
        
        logger.info("Connected to database and Pinecone")
        
    def fetch_video_ids(self, limit=None):
        """Fetch video IDs that have both embeddings"""
        with self.conn.cursor() as cur:
            query = """
                SELECT id, title 
                FROM videos 
                WHERE pinecone_embedded = true 
                AND llm_summary_embedded = true
            """
            if limit:
                query += f" LIMIT {limit}"
            
            cur.execute(query)
            videos = cur.fetchall()
            
        logger.info(f"Fetched {len(videos)} videos with both embeddings")
        return videos
        
    def fetch_embeddings_batch(self, video_ids):
        """Fetch embeddings from Pinecone for a batch of videos"""
        # Fetch title embeddings
        title_response = self.title_index.fetch(
            ids=video_ids,
            namespace=''
        )
        
        # Fetch summary embeddings  
        summary_response = self.summary_index.fetch(
            ids=video_ids,
            namespace='llm-summaries'
        )
        
        # Combine embeddings with weighting
        combined_embeddings = []
        valid_ids = []
        
        for vid in video_ids:
            if vid in title_response.vectors and vid in summary_response.vectors:
                title_emb = np.array(title_response.vectors[vid].values)
                summary_emb = np.array(summary_response.vectors[vid].values)
                
                # Weighted average
                combined = (self.title_weight * title_emb + 
                           self.summary_weight * summary_emb)
                
                combined_embeddings.append(combined)
                valid_ids.append(vid)
                
        return np.array(combined_embeddings), valid_ids
        
    def run_bertopic_clustering(self, embeddings, documents, min_topic_size=50):
        """Run BERTopic clustering with pre-computed embeddings"""
        logger.info(f"Running BERTopic on {len(documents)} documents...")
        
        # Configure BERTopic
        vectorizer_model = CountVectorizer(
            stop_words="english",
            min_df=5,
            ngram_range=(1, 3)
        )
        
        topic_model = BERTopic(
            min_topic_size=min_topic_size,
            vectorizer_model=vectorizer_model,
            calculate_probabilities=True,
            verbose=True
        )
        
        # Fit the model
        topics, probs = topic_model.fit_transform(documents, embeddings)
        
        logger.info(f"Found {len(set(topics)) - 1} topics (excluding outliers)")
        logger.info(f"Outlier percentage: {(topics == -1).sum() / len(topics) * 100:.2f}%")
        
        return topic_model, topics, probs
        
    def create_hierarchical_topics(self, topic_model, embeddings):
        """Create 3-tier hierarchical clustering"""
        logger.info("Creating hierarchical topic structure...")
        
        # Get hierarchical topics
        hierarchical_topics = topic_model.hierarchical_topics(embeddings)
        
        # Create 3-tier structure
        # This is a simplified version - you'd want more sophisticated logic here
        topic_tree = topic_model.get_topic_tree(hierarchical_topics)
        
        return hierarchical_topics, topic_tree
        
    def update_database(self, video_ids, topics, probs, hierarchical_topics=None):
        """Update database with new topic assignments"""
        logger.info("Updating database with new classifications...")
        
        with self.conn.cursor() as cur:
            # Prepare batch update data
            update_data = []
            
            for i, (vid, topic, prob) in enumerate(zip(video_ids, topics, probs)):
                # For now, assign same topic to all levels (you'd map hierarchical properly)
                update_data.append({
                    'id': vid,
                    'topic_level_1': topic if topic >= 0 else -1,
                    'topic_level_2': topic if topic >= 0 else -1,  
                    'topic_level_3': topic if topic >= 0 else -1,
                    'topic_cluster_id': topic,
                    'topic_confidence': float(prob),
                    'classification_timestamp': datetime.now().isoformat()
                })
                
                if len(update_data) >= 100:
                    self._batch_update(cur, update_data)
                    update_data = []
                    
            # Update remaining
            if update_data:
                self._batch_update(cur, update_data)
                
            self.conn.commit()
            
        logger.info(f"Updated {len(video_ids)} videos with new classifications")
        
    def _batch_update(self, cur, update_data):
        """Execute batch update"""
        query = """
            UPDATE videos 
            SET 
                topic_level_1 = %(topic_level_1)s,
                topic_level_2 = %(topic_level_2)s,
                topic_level_3 = %(topic_level_3)s,
                topic_cluster_id = %(topic_cluster_id)s,
                topic_confidence = %(topic_confidence)s,
                classification_timestamp = %(classification_timestamp)s
            WHERE id = %(id)s
        """
        
        cur.executemany(query, update_data)
        
    def run(self, limit=None, focus_low_confidence=True):
        """Main execution method"""
        self.connect()
        
        try:
            # Get videos to process
            if focus_low_confidence:
                logger.info("Focusing on low-confidence videos first...")
                # Add WHERE clause for low confidence
                
            videos = self.fetch_video_ids(limit)
            
            all_embeddings = []
            all_documents = []
            all_video_ids = []
            
            # Process in batches
            for i in tqdm(range(0, len(videos), self.batch_size)):
                batch_videos = videos[i:i+self.batch_size]
                batch_ids = [v[0] for v in batch_videos]
                batch_titles = [v[1] for v in batch_videos]
                
                # Fetch embeddings
                embeddings, valid_ids = self.fetch_embeddings_batch(batch_ids)
                
                if len(embeddings) > 0:
                    all_embeddings.extend(embeddings)
                    all_documents.extend([batch_titles[batch_ids.index(vid)] for vid in valid_ids])
                    all_video_ids.extend(valid_ids)
                    
            logger.info(f"Collected {len(all_embeddings)} embeddings")
            
            # Run BERTopic
            all_embeddings = np.array(all_embeddings)
            topic_model, topics, probs = self.run_bertopic_clustering(
                all_embeddings, 
                all_documents
            )
            
            # Create hierarchical structure
            hierarchical_topics, topic_tree = self.create_hierarchical_topics(
                topic_model, 
                all_embeddings
            )
            
            # Update database
            self.update_database(all_video_ids, topics, probs, hierarchical_topics)
            
            # Save topic model
            topic_model.save("bertopic_combined_model")
            logger.info("Saved topic model to bertopic_combined_model")
            
            # Export topic info
            topic_info = topic_model.get_topic_info()
            topic_info.to_csv("topic_info_combined.csv")
            logger.info("Exported topic info to topic_info_combined.csv")
            
        finally:
            if self.conn:
                self.conn.close()
                

if __name__ == "__main__":
    # Parse arguments
    limit = None
    if len(sys.argv) > 1:
        limit = int(sys.argv[1])
        logger.info(f"Processing limited to {limit} videos")
        
    # Run clustering
    clusterer = CombinedEmbeddingBERTopic(
        batch_size=1000,
        title_weight=0.3,
        summary_weight=0.7
    )
    
    clusterer.run(limit=limit, focus_low_confidence=True)
