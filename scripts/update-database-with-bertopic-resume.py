#!/usr/bin/env python3
"""
Update Supabase database with BERTopic classifications - Resumable version
This script can resume from where it left off if interrupted
"""

import os
import json
import pickle
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from tqdm import tqdm
from pinecone import Pinecone

load_dotenv()

# Initialize Supabase client
supabase: Client = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

# Pinecone configuration
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')

# Checkpoint file to track progress
CHECKPOINT_FILE = 'bertopic_update_checkpoint.json'

class BERTopicResumableUpdater:
    def __init__(self):
        """Initialize the updater with saved model and data"""
        print("Loading BERTopic model and data...")
        
        # Load the trained model
        self.model = BERTopic.load("bertopic_model_smart_20250801_131447")
        
        # Load the sample indices
        with open('bertopic_sample_indices.pkl', 'rb') as f:
            self.sample_indices = set(pickle.load(f))
        
        # Load topic names
        with open('better_topic_names_v2.json', 'r') as f:
            self.topic_names_data = json.load(f)
            self.topic_names = {
                int(k): v for k, v in self.topic_names_data['topics'].items()
            }
        
        # Load video data
        with open('bertopic_valid_videos_176929.pkl', 'rb') as f:
            self.all_video_data = pickle.load(f)
        
        # Initialize Pinecone
        self.pc = Pinecone(api_key=PINECONE_API_KEY)
        self.index = self.pc.Index(os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod'))
        
        print(f"✅ Loaded model with {len(self.topic_names)} topics")
        print(f"✅ Found {len(self.sample_indices)} videos in training sample")
        
        # Load checkpoint if exists
        self.checkpoint = self.load_checkpoint()
    
    def load_checkpoint(self):
        """Load progress checkpoint if it exists"""
        if os.path.exists(CHECKPOINT_FILE):
            with open(CHECKPOINT_FILE, 'r') as f:
                checkpoint = json.load(f)
                # Convert list back to set for processed_ids
                checkpoint['processed_ids'] = set(checkpoint.get('processed_ids', []))
                print(f"\n📌 Found checkpoint: {checkpoint['processed_count']} videos already processed")
                return checkpoint
        return {
            'processed_count': 0,
            'processed_ids': set(),
            'start_time': datetime.utcnow().isoformat(),
            'training_complete': False
        }
    
    def save_checkpoint(self):
        """Save current progress"""
        # Convert set to list for JSON serialization
        checkpoint_data = self.checkpoint.copy()
        checkpoint_data['processed_ids'] = list(self.checkpoint['processed_ids'])
        
        with open(CHECKPOINT_FILE, 'w') as f:
            json.dump(checkpoint_data, f)
    
    def get_all_classifications(self):
        """Get all classifications (training + new) in order"""
        classifications = []
        
        # First, get training sample classifications
        topics = self.model.topics_
        training_videos = []
        
        for idx, video in enumerate(self.all_video_data):
            if idx in self.sample_indices:
                training_videos.append((idx, video))
        
        # Sort by index to match topics array
        training_videos.sort(key=lambda x: x[0])
        
        # Get classifications for training videos
        for enum_idx, (orig_idx, video) in enumerate(training_videos):
            if enum_idx < len(topics):
                topic = topics[enum_idx]
                # Include outliers too (topic -1)
                classifications.append({
                    'video_id': video['id'],
                    'topic_id': int(topic),
                    'confidence': 0.9 if topic >= 0 else 0.3,
                    'topic_name': self.topic_names.get(topic, {}).get('name', 'Outlier' if topic == -1 else f'Topic {topic}'),
                    'category': self.topic_names.get(topic, {}).get('category', 'Outlier' if topic == -1 else 'Unknown'),
                    'subcategory': self.topic_names.get(topic, {}).get('subcategory', 'Outlier' if topic == -1 else 'Unknown'),
                    'is_training': True
                })
        
        print(f"\n✅ Prepared {len(classifications)} training video classifications")
        return classifications
    
    def fetch_and_classify_batch(self, videos):
        """Fetch embeddings and classify a batch of videos"""
        video_ids = [v['id'] for v in videos]
        
        try:
            # Fetch embeddings from Pinecone
            response = self.index.fetch(ids=video_ids, namespace='llm-summaries')
            
            embeddings = []
            valid_videos = []
            
            if hasattr(response, 'vectors'):
                for vid_id in video_ids:
                    if vid_id in response.vectors:
                        vector_data = response.vectors[vid_id]
                        if hasattr(vector_data, 'values'):
                            embeddings.append(vector_data.values)
                            valid_videos.append(next(v for v in videos if v['id'] == vid_id))
            
            if not embeddings:
                return []
            
            embeddings = np.array(embeddings)
            
            # Classify using BERTopic
            # Create dummy documents since we already have embeddings
            dummy_docs = [''] * len(embeddings)
            topics, probs = self.model.transform(dummy_docs, embeddings)
            
            results = []
            for video, topic, prob in zip(valid_videos, topics, probs):
                results.append({
                    'video_id': video['id'],
                    'topic_id': int(topic),
                    'confidence': float(prob),
                    'topic_name': self.topic_names.get(topic, {}).get('name', 'Outlier' if topic == -1 else f'Topic {topic}'),
                    'category': self.topic_names.get(topic, {}).get('category', 'Outlier' if topic == -1 else 'Unknown'),
                    'subcategory': self.topic_names.get(topic, {}).get('subcategory', 'Outlier' if topic == -1 else 'Unknown'),
                    'is_training': False
                })
            
            return results
            
        except Exception as e:
            print(f"\nError fetching/classifying batch: {e}")
            return []
    
    def run_update(self):
        """Main update process"""
        print("="*60)
        print("BERTopic Database Update - Resumable Version")
        print("="*60)
        
        # Check if we have cached classifications
        classifications_cache_file = 'bertopic_classifications_cache.pkl'
        
        if os.path.exists(classifications_cache_file):
            print(f"\n📂 Found cached classifications, loading...")
            with open(classifications_cache_file, 'rb') as f:
                all_classifications = pickle.load(f)
            print(f"✅ Loaded {len(all_classifications)} classifications from cache")
        else:
            # Get all training classifications first
            all_classifications = self.get_all_classifications()
        
        # Add new video classifications
        new_videos = []
        for idx, video in enumerate(self.all_video_data):
            if idx not in self.sample_indices:
                new_videos.append(video)
        
        print(f"\n📊 Classification Plan:")
        print(f"   - Training videos: {len(all_classifications)}")
        print(f"   - New videos to classify: {len(new_videos)}")
        print(f"   - Already processed: {self.checkpoint['processed_count']}")
        
        # Process new videos in batches
        print(f"\n🔄 Classifying {len(new_videos)} new videos...")
        batch_size = 100
        
        with tqdm(total=len(new_videos), desc="Classifying") as pbar:
            for i in range(0, len(new_videos), batch_size):
                batch = new_videos[i:i+batch_size]
                batch_classifications = self.fetch_and_classify_batch(batch)
                all_classifications.extend(batch_classifications)
                pbar.update(len(batch))
        
        print(f"\n✅ Total classifications ready: {len(all_classifications)}")
        
        # Save classifications to disk if we just computed them
        if not os.path.exists(classifications_cache_file):
            print(f"\n💾 Saving classifications to cache for future runs...")
            with open(classifications_cache_file, 'wb') as f:
                pickle.dump(all_classifications, f)
            print(f"✅ Saved {len(all_classifications)} classifications to {classifications_cache_file}")
        
        # Update database
        print("\n📝 Updating database...")
        updated = 0
        failed = 0
        skipped = 0
        
        # Filter out already processed videos
        classifications_to_process = [
            c for c in all_classifications 
            if c['video_id'] not in self.checkpoint['processed_ids']
        ]
        
        print(f"   - Videos to update: {len(classifications_to_process)}")
        
        start_time = time.time()
        last_checkpoint_save = time.time()
        
        # Process in batches for better performance
        batch_size = 50  # Increased from 1 to 50 for parallel updates
        
        with tqdm(total=len(classifications_to_process), desc="Updating database") as pbar:
            for i in range(0, len(classifications_to_process), batch_size):
                batch = classifications_to_process[i:i+batch_size]
                batch_updates = []
                
                # Process all items in the batch
                batch_success = True
                for item in batch:
                    try:
                        # Use UPDATE not UPSERT to avoid null channel_id issues
                        response = supabase.table('videos').update({
                            'topic_cluster_id': item['topic_id'],
                            'topic_domain': item['category'],
                            'topic_niche': item['subcategory'],
                            'topic_micro': item['topic_name'],
                            'topic_confidence': item['confidence'],
                            'bertopic_version': 'v1_2025-08-01',
                            'classified_at': datetime.utcnow().isoformat()
                        }).eq('id', item['video_id']).execute()
                        
                        updated += 1
                        self.checkpoint['processed_ids'].add(item['video_id'])
                        self.checkpoint['processed_count'] += 1
                        
                    except Exception as e:
                        print(f"\nError updating {item['video_id']}: {e}")
                        failed += 1
                        batch_success = False
                
                pbar.update(len(batch))
                
                # Update progress info
                if updated > 0:
                    elapsed = time.time() - start_time
                    rate = updated / elapsed
                    remaining = len(classifications_to_process) - updated - failed
                    eta = remaining / rate if rate > 0 else 0
                    
                    pbar.set_postfix({
                        'rate': f'{rate:.1f}/s',
                        'eta': f'{eta/60:.0f}m',
                        'updated': updated,
                        'failed': failed
                    })
                
                # Save checkpoint every 30 seconds
                if time.time() - last_checkpoint_save > 30:
                    self.save_checkpoint()
                    last_checkpoint_save = time.time()
        
        # Final checkpoint save
        self.save_checkpoint()
        
        # Final report
        elapsed = time.time() - start_time
        print(f"\n✅ Update complete!")
        print(f"   - Successfully updated: {updated} videos")
        print(f"   - Failed: {failed} videos")
        print(f"   - Total time: {elapsed/60:.1f} minutes")
        print(f"   - Average rate: {updated/elapsed:.1f} videos/second")
        
        # Clean up checkpoint file
        if os.path.exists(CHECKPOINT_FILE):
            os.remove(CHECKPOINT_FILE)
            print(f"\n🧹 Checkpoint file removed")
        
        # Also clean up classifications cache since we're done
        if os.path.exists(classifications_cache_file):
            os.remove(classifications_cache_file)
            print(f"🧹 Classifications cache removed")

def main():
    updater = BERTopicResumableUpdater()
    updater.run_update()

if __name__ == "__main__":
    main()