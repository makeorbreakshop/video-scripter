#!/usr/bin/env python3
"""
Incremental Topic Classifier

Classifies new videos against existing BERTopic model without full retraining.
Much faster and more scalable for daily updates.
"""

import os
import numpy as np
from pinecone import Pinecone
from supabase import create_client
from dotenv import load_dotenv
import json
from tqdm import tqdm
import logging
from datetime import datetime, timedelta
from sklearn.metrics.pairwise import cosine_similarity
import pickle

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

load_dotenv()

class IncrementalTopicClassifier:
    def __init__(self, model_path="bertopic_model_combined", centroids_path=None):
        self.model_path = model_path
        self.centroids_path = centroids_path
        self.topic_centroids = {}
        self.topic_info = {}
        
        # Initialize connections
        self.supabase = create_client(
            os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
            os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        )
        self.pc = Pinecone(api_key=os.getenv('PINECONE_API_KEY'))
        self.index = self.pc.Index(os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod'))
        
    def load_or_calculate_centroids(self):
        """Load existing centroids or calculate from database"""
        if self.centroids_path and os.path.exists(self.centroids_path):
            logger.info(f"Loading centroids from {self.centroids_path}")
            with open(self.centroids_path, 'rb') as f:
                self.topic_centroids = pickle.load(f)
        else:
            logger.info("Calculating topic centroids from database...")
            self.calculate_topic_centroids()
            
    def calculate_topic_centroids(self):
        """Calculate centroids for each topic from existing classifications"""
        # Get topic distribution
        result = self.supabase.table('videos') \
            .select('topic_cluster_id') \
            .not_.is_('topic_cluster_id', None) \
            .execute()
            
        topic_counts = {}
        for row in result.data:
            topic_id = row['topic_cluster_id']
            topic_counts[topic_id] = topic_counts.get(topic_id, 0) + 1
            
        logger.info(f"Found {len(topic_counts)} topics to calculate centroids for")
        
        # For each topic, get sample videos and calculate centroid
        for topic_id in tqdm(topic_counts.keys(), desc="Calculating centroids"):
            if topic_id == -1:  # Skip outliers
                continue
                
            # Get sample of videos from this topic
            sample_videos = self.supabase.table('videos') \
                .select('id') \
                .eq('topic_cluster_id', topic_id) \
                .limit(100) \
                .execute()
                
            if not sample_videos.data:
                continue
                
            video_ids = [v['id'] for v in sample_videos.data]
            
            # Fetch embeddings
            embeddings = []
            title_response = self.index.fetch(ids=video_ids, namespace='')
            summary_response = self.index.fetch(ids=video_ids, namespace='llm-summaries')
            
            for vid in video_ids:
                if vid in title_response.vectors and vid in summary_response.vectors:
                    title_emb = np.array(title_response.vectors[vid].values)
                    summary_emb = np.array(summary_response.vectors[vid].values)
                    combined = 0.3 * title_emb + 0.7 * summary_emb
                    embeddings.append(combined)
                    
            if embeddings:
                # Calculate centroid
                centroid = np.mean(embeddings, axis=0)
                self.topic_centroids[topic_id] = centroid
                
        # Save centroids
        centroids_file = f"topic_centroids_{datetime.now().strftime('%Y%m%d')}.pkl"
        with open(centroids_file, 'wb') as f:
            pickle.dump(self.topic_centroids, f)
        logger.info(f"Saved centroids to {centroids_file}")
        
    def classify_new_videos(self, hours_back=24):
        """Classify videos added in the last N hours"""
        cutoff_time = datetime.now() - timedelta(hours=hours_back)
        
        # Get new videos without classifications
        new_videos = self.supabase.table('videos') \
            .select('id, title, metadata->channelTitle') \
            .is_('topic_cluster_id', None) \
            .gte('created_at', cutoff_time.isoformat()) \
            .execute()
            
        if not new_videos.data:
            logger.info("No new videos to classify")
            return
            
        logger.info(f"Found {len(new_videos.data)} new videos to classify")
        
        # Process in batches
        classifications = []
        batch_size = 100
        
        for i in tqdm(range(0, len(new_videos.data), batch_size), desc="Classifying"):
            batch = new_videos.data[i:i+batch_size]
            batch_ids = [v['id'] for v in batch]
            
            # Fetch embeddings
            title_response = self.index.fetch(ids=batch_ids, namespace='')
            summary_response = self.index.fetch(ids=batch_ids, namespace='llm-summaries')
            
            for video in batch:
                vid = video['id']
                
                if vid in title_response.vectors and vid in summary_response.vectors:
                    # Combine embeddings
                    title_emb = np.array(title_response.vectors[vid].values)
                    summary_emb = np.array(summary_response.vectors[vid].values)
                    combined = 0.3 * title_emb + 0.7 * summary_emb
                    
                    # Find nearest centroid
                    best_topic = -1
                    best_similarity = -1
                    
                    for topic_id, centroid in self.topic_centroids.items():
                        similarity = cosine_similarity([combined], [centroid])[0][0]
                        if similarity > best_similarity:
                            best_similarity = similarity
                            best_topic = topic_id
                            
                    # Only assign if confidence is high enough
                    if best_similarity > 0.7:
                        classifications.append({
                            'id': vid,
                            'topic_cluster_id': int(best_topic),
                            'topic_confidence': float(best_similarity),
                            'classification_method': 'incremental',
                            'classification_timestamp': datetime.now().isoformat()
                        })
                    else:
                        # Mark as outlier with low confidence
                        classifications.append({
                            'id': vid,
                            'topic_cluster_id': -1,
                            'topic_confidence': float(best_similarity),
                            'classification_method': 'incremental_outlier',
                            'classification_timestamp': datetime.now().isoformat()
                        })
                        
        # Update database
        if classifications:
            logger.info(f"Updating {len(classifications)} classifications...")
            for c in classifications:
                self.supabase.table('videos') \
                    .update({
                        'topic_cluster_id': c['topic_cluster_id'],
                        'topic_confidence': c['topic_confidence']
                    }) \
                    .eq('id', c['id']) \
                    .execute()
                    
        # Calculate statistics
        outliers = sum(1 for c in classifications if c['topic_cluster_id'] == -1)
        avg_confidence = np.mean([c['topic_confidence'] for c in classifications])
        
        logger.info(f"\nClassification complete:")
        logger.info(f"  Total classified: {len(classifications)}")
        logger.info(f"  Outliers: {outliers} ({outliers/len(classifications)*100:.1f}%)")
        logger.info(f"  Average confidence: {avg_confidence:.3f}")
        
        # Save results
        results_file = f"incremental_classifications_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump({
                'metadata': {
                    'timestamp': datetime.now().isoformat(),
                    'total_classified': len(classifications),
                    'outlier_count': outliers,
                    'avg_confidence': avg_confidence
                },
                'classifications': classifications
            }, f)
            
        return classifications
        
    def check_retraining_needed(self):
        """Check if full retraining is needed based on metrics"""
        # Get recent classification stats
        recent = self.supabase.table('videos') \
            .select('topic_confidence, topic_cluster_id') \
            .gte('created_at', (datetime.now() - timedelta(days=7)).isoformat()) \
            .execute()
            
        if not recent.data:
            return False
            
        # Calculate metrics
        outliers = sum(1 for r in recent.data if r['topic_cluster_id'] == -1)
        outlier_rate = outliers / len(recent.data)
        
        low_confidence = sum(1 for r in recent.data if r['topic_confidence'] and r['topic_confidence'] < 0.7)
        low_conf_rate = low_confidence / len(recent.data)
        
        logger.info(f"\nRetraining metrics:")
        logger.info(f"  Recent outlier rate: {outlier_rate:.1%}")
        logger.info(f"  Low confidence rate: {low_conf_rate:.1%}")
        
        # Trigger retraining if thresholds exceeded
        if outlier_rate > 0.2 or low_conf_rate > 0.3:
            logger.warning("⚠️  Retraining recommended!")
            return True
            
        return False
        

def main():
    classifier = IncrementalTopicClassifier()
    
    # Load or calculate centroids
    classifier.load_or_calculate_centroids()
    
    # Classify new videos from last 24 hours
    classifier.classify_new_videos(hours_back=24)
    
    # Check if retraining needed
    classifier.check_retraining_needed()
    

if __name__ == "__main__":
    print("\n" + "="*60)
    print("Incremental Topic Classifier")
    print("="*60)
    print("\nThis classifies new videos against existing topics")
    print("Much faster than full BERTopic retraining!")
    print("="*60 + "\n")
    
    main()