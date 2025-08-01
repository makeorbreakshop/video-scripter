#!/usr/bin/env python3
"""
Update Supabase database with BERTopic classifications - Streaming version
This script processes videos in small batches for better progress visibility
"""

import os
import json
import pickle
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from supabase import create_client, Client
from dotenv import load_dotenv
import asyncio
from tqdm import tqdm
import time
from pinecone import Pinecone

load_dotenv()

# Initialize Supabase client
supabase: Client = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

# Pinecone configuration
PINECONE_API_KEY = os.getenv('PINECONE_API_KEY')

class BERTopicStreamingUpdater:
    def __init__(self):
        """Initialize the updater with saved model and data"""
        print("Loading BERTopic model and data...")
        
        # Load the trained model
        self.model = BERTopic.load("bertopic_model_smart_20250801_131447")
        
        # Load the sample indices (to know which videos were in training)
        with open('bertopic_sample_indices.pkl', 'rb') as f:
            self.sample_indices = set(pickle.load(f))
        
        # Load topic names
        with open('better_topic_names_v2.json', 'r') as f:
            self.topic_names_data = json.load(f)
            self.topic_names = {
                int(k): v for k, v in self.topic_names_data['topics'].items()
            }
        
        # Load saved embeddings and video data for the sample
        with open('bertopic_embeddings.pkl', 'rb') as f:
            self.sample_embeddings = pickle.load(f)
        
        with open('bertopic_valid_videos_176929.pkl', 'rb') as f:
            self.all_video_data = pickle.load(f)
        
        # Initialize Pinecone
        self.pc = Pinecone(api_key=PINECONE_API_KEY)
        self.index = self.pc.Index(os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod'))
        
        print(f"✅ Loaded model with {len(self.topic_names)} topics")
        print(f"✅ Found {len(self.sample_indices)} videos in training sample")
    
    def get_training_sample_classifications(self, videos_in_sample):
        """Get classifications for videos that were in the training sample"""
        print(f"\nGetting classifications for {len(videos_in_sample)} training videos...")
        
        # These videos already have topics assigned during training
        topics = self.model.topics_
        print(f"Model has {len(topics)} topic assignments")
        
        results = []
        # The topics array corresponds to the order of videos in the training sample
        # not the original indices in the full dataset
        for idx, (orig_idx, video) in enumerate(videos_in_sample):
            if idx < len(topics):  # Use enumerated index, not original index
                topic = topics[idx]
                if topic >= 0:  # Skip outliers (-1)
                    results.append({
                        'video_id': video['id'],
                        'topic_id': int(topic),
                        'confidence': 0.9,  # High confidence for training data
                        'topic_name': self.topic_names.get(topic, {}).get('name', f'Topic {topic}'),
                        'category': self.topic_names.get(topic, {}).get('category', 'Unknown'),
                        'subcategory': self.topic_names.get(topic, {}).get('subcategory', 'Unknown')
                    })
        
        print(f"Found {len(results)} videos with valid topics (excluding outliers)")
        print(f"Outliers in training data: {len(videos_in_sample) - len(results)} ({(len(videos_in_sample) - len(results))/len(videos_in_sample)*100:.1f}%)")
        return results
    
    async def classify_videos_batch(self, video_batch):
        """Classify a single batch of videos"""
        # Extract video IDs
        video_ids = [v[1]['id'] for v in video_batch]
        
        # Fetch embeddings from Pinecone
        try:
            response = self.index.fetch(ids=video_ids, namespace='llm-summaries')
            
            embeddings = []
            valid_videos = []
            
            # Extract embeddings from response
            if hasattr(response, 'vectors'):
                for vid_id in video_ids:
                    if vid_id in response.vectors:
                        vector_data = response.vectors[vid_id]
                        if hasattr(vector_data, 'values'):
                            embeddings.append(vector_data.values)
                            valid_videos.append(next(v[1] for v in video_batch if v[1]['id'] == vid_id))
            
            if not embeddings:
                return []
            
            embeddings = np.array(embeddings)
            
            # Use transform to get topic assignments
            topics, probs = self.model.transform(embeddings)
            
            # Combine with video data
            results = []
            for video, topic, prob in zip(valid_videos, topics, probs):
                results.append({
                    'video_id': video['id'],
                    'topic_id': int(topic),
                    'confidence': float(prob),
                    'topic_name': self.topic_names.get(topic, {}).get('name', f'Topic {topic}'),
                    'category': self.topic_names.get(topic, {}).get('category', 'Unknown'),
                    'subcategory': self.topic_names.get(topic, {}).get('subcategory', 'Unknown')
                })
            
            return results
            
        except Exception as e:
            print(f"Error processing batch: {e}")
            return []
    
    async def update_database_batch(self, classifications, progress_bar=None):
        """Update database with a batch of classifications"""
        updated_count = 0
        failed_count = 0
        
        # Process updates in parallel batches for speed
        batch_tasks = []
        
        async def update_single_video(item):
            try:
                response = supabase.table('videos').update({
                    'topic_cluster_id': item['topic_id'],
                    'topic_domain': item['category'],
                    'topic_niche': item['subcategory'],
                    'topic_micro': item['topic_name'],
                    'topic_confidence': item['confidence'],
                    'bertopic_version': 'v1_2025-08-01',
                    'classified_at': datetime.utcnow().isoformat()
                }).eq('id', item['video_id']).execute()
                return True, None
            except Exception as e:
                return False, f"Error updating video {item['video_id']}: {e}"
        
        # Create tasks for parallel execution (limit concurrency to 5 to avoid 502 errors)
        for i in range(0, len(classifications), 5):
            batch = classifications[i:i+5]
            tasks = [update_single_video(item) for item in batch]
            results = await asyncio.gather(*tasks)
            
            for success, error in results:
                if success:
                    updated_count += 1
                else:
                    failed_count += 1
                    if error:
                        print(f"\n{error}")
            
            if progress_bar:
                progress_bar.update(len(batch))
            
            # Small delay between parallel batches to avoid overwhelming the server
            await asyncio.sleep(0.1)
        
        return updated_count, failed_count
    
    async def run_streaming(self):
        """Main execution flow with streaming updates"""
        print("="*60)
        print("BERTopic Database Update - Streaming Mode")
        print("="*60)
        
        # Separate videos into groups
        videos_in_sample = []
        videos_need_transform = []
        
        for idx, video in enumerate(self.all_video_data):
            if idx in self.sample_indices:
                videos_in_sample.append((idx, video))
            else:
                videos_need_transform.append((idx, video))
        
        print(f"\nUpdate Plan:")
        print(f"- Videos in training sample: {len(videos_in_sample)}")
        print(f"- Videos needing classification: {len(videos_need_transform)}")
        print(f"- Total videos: {len(self.all_video_data)}")
        
        # Process training sample first
        total_updated = 0
        total_failed = 0
        
        if videos_in_sample:
            training_classifications = self.get_training_sample_classifications(videos_in_sample)
            
            print(f"\nUpdating {len(training_classifications)} training videos...")
            with tqdm(total=len(training_classifications), desc="Training videos") as pbar:
                # Process in batches of 50
                for i in range(0, len(training_classifications), 50):
                    batch = training_classifications[i:i+50]
                    updated, failed = await self.update_database_batch(batch, pbar)
                    total_updated += updated
                    total_failed += failed
        
        # Process new videos in streaming batches
        if videos_need_transform:
            print(f"\nProcessing {len(videos_need_transform)} new videos in batches...")
            
            batch_size = 200  # Moderate batch size to balance speed and stability
            
            with tqdm(total=len(videos_need_transform), desc="New videos") as pbar:
                for i in range(0, len(videos_need_transform), batch_size):
                    batch = videos_need_transform[i:i+batch_size]
                    
                    # Classify this batch
                    classifications = await self.classify_videos_batch(batch)
                    
                    if classifications:
                        # Update database immediately
                        updated, failed = await self.update_database_batch(classifications)
                        total_updated += updated
                        total_failed += failed
                        pbar.update(len(batch))
                        
                        # Show intermediate progress
                        if (i + batch_size) % 1000 == 0:
                            pbar.set_postfix({
                                'updated': total_updated,
                                'failed': total_failed,
                                'rate': f'{pbar.n/pbar.elapsed:.1f} videos/s'
                            })
                    else:
                        pbar.update(len(batch))
                        pbar.set_postfix({'status': 'No embeddings found for batch'})
        
        # Final report
        print(f"\n✅ Update complete!")
        print(f"   - Successfully updated: {total_updated} videos")
        print(f"   - Failed: {total_failed} videos")
        print(f"   - Skipped (no embeddings): {len(self.all_video_data) - total_updated - total_failed} videos")
        
        # Save results for verification
        output_file = f"bertopic_streaming_update_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump({
                'metadata': {
                    'total_processed': total_updated + total_failed,
                    'successful': total_updated,
                    'failed': total_failed,
                    'model_version': 'bertopic_model_smart_20250801_131447',
                    'update_timestamp': datetime.utcnow().isoformat(),
                    'topics_used': len(self.topic_names)
                }
            }, f, indent=2)
        
        print(f"\nResults saved to {output_file}")

async def main():
    updater = BERTopicStreamingUpdater()
    await updater.run_streaming()

if __name__ == "__main__":
    asyncio.run(main())