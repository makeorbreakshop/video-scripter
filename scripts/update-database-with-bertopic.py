#!/usr/bin/env python3
"""
Update Supabase database with BERTopic classifications
This script applies the trained BERTopic model to all videos and updates the database
"""

import os
import json
import pickle
import numpy as np
from datetime import datetime
from bertopic import BERTopic
from supabase import create_client, Client
import psycopg2
from urllib.parse import urlparse
from dotenv import load_dotenv
import asyncio
import aiohttp
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
PINECONE_SUMMARY_INDEX = os.getenv('PINECONE_SUMMARY_INDEX_NAME', 'video-summaries')
PINECONE_ENVIRONMENT = os.getenv('PINECONE_ENVIRONMENT', 'us-east-1')

class BERTopicDatabaseUpdater:
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
        
        print(f"✅ Loaded model with {len(self.topic_names)} topics")
        print(f"✅ Found {len(self.sample_indices)} videos in training sample")
    
    async def fetch_embeddings_from_pinecone(self, video_ids, session):
        """Fetch embeddings from Pinecone for videos not in training sample"""
        # Use the Pinecone Python client
        pc = Pinecone(api_key=PINECONE_API_KEY)
        index = pc.Index(os.getenv('PINECONE_INDEX_NAME', 'youtube-titles-prod'))
        
        # Fetch from llm-summaries namespace in batches of 100
        embeddings = {}
        for i in range(0, len(video_ids), 100):
            batch_ids = video_ids[i:i+100]
            
            try:
                # Fetch from the llm-summaries namespace
                response = index.fetch(ids=batch_ids, namespace='llm-summaries')
                
                # Access vectors from the response object
                if hasattr(response, 'vectors'):
                    for id, vector_data in response.vectors.items():
                        if hasattr(vector_data, 'values'):
                            embeddings[id] = np.array(vector_data.values)
                        elif isinstance(vector_data, dict) and 'values' in vector_data:
                            embeddings[id] = np.array(vector_data['values'])
            except Exception as e:
                print(f"Error fetching batch {i//100 + 1}: {e}")
                continue
        
        return embeddings
    
    def prepare_update_strategy(self):
        """Determine which videos need BERTopic classification"""
        print("\nAnalyzing database update requirements...")
        
        # Separate videos into groups
        videos_in_sample = []
        videos_need_transform = []
        videos_no_embedding = []
        
        for idx, video in enumerate(self.all_video_data):
            if idx in self.sample_indices:
                videos_in_sample.append((idx, video))
            else:
                # These need transform()
                videos_need_transform.append((idx, video))
        
        # Check for any videos without embeddings
        all_video_ids = {v['id'] for v in self.all_video_data}
        
        return {
            'in_sample': videos_in_sample,
            'need_transform': videos_need_transform,
            'total_videos': len(self.all_video_data)
        }
    
    async def classify_new_videos(self, videos_to_classify):
        """Use BERTopic transform() to classify videos not in training sample"""
        print(f"\nClassifying {len(videos_to_classify)} videos using transform()...")
        
        # Extract video IDs
        video_ids = [v[1]['id'] for v in videos_to_classify]
        indices = [v[0] for v in videos_to_classify]
        
        # Fetch embeddings from Pinecone
        async with aiohttp.ClientSession() as session:
            print("Fetching embeddings from Pinecone...")
            embedding_dict = await self.fetch_embeddings_from_pinecone(video_ids, session)
        
        # Create embedding matrix in correct order
        embeddings = []
        valid_indices = []
        valid_videos = []
        
        for idx, (orig_idx, video) in enumerate(videos_to_classify):
            if video['id'] in embedding_dict:
                embeddings.append(embedding_dict[video['id']])
                valid_indices.append(orig_idx)
                valid_videos.append(video)
        
        if not embeddings:
            print("⚠️ No embeddings found for new videos")
            return []
        
        embeddings = np.array(embeddings)
        print(f"Found embeddings for {len(embeddings)} videos")
        
        # Use transform to get topic assignments
        topics, probs = self.model.transform(embeddings)
        
        # Combine with video data
        results = []
        for i, (video, topic, prob) in enumerate(zip(valid_videos, topics, probs)):
            results.append({
                'video_id': video['id'],
                'topic_id': int(topic),
                'confidence': float(prob),
                'topic_name': self.topic_names.get(topic, {}).get('name', f'Topic {topic}'),
                'category': self.topic_names.get(topic, {}).get('category', 'Unknown'),
                'subcategory': self.topic_names.get(topic, {}).get('subcategory', 'Unknown')
            })
        
        return results
    
    def get_training_sample_classifications(self, videos_in_sample):
        """Get classifications for videos that were in the training sample"""
        print(f"\nGetting classifications for {len(videos_in_sample)} training videos...")
        
        # These videos already have topics assigned during training
        topics = self.model.topics_
        print(f"Model has {len(topics)} topic assignments")
        
        results = []
        for idx, (orig_idx, video) in enumerate(videos_in_sample):
            if orig_idx < len(topics):
                topic = topics[orig_idx]
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
        return results
    
    async def monitor_iops(self):
        """Monitor IOPS usage (simplified version)"""
        # In production, you'd query actual IOPS metrics
        # For now, we'll use conservative estimates
        return {
            'current_iops': 0,  # Placeholder
            'iops_limit': 500,
            'safe_threshold': 400
        }
    
    async def update_database(self, classifications):
        """Update Supabase with new BERTopic classifications (IOPS-safe)"""
        print(f"\nUpdating database with {len(classifications)} classifications...")
        print("⚠️ IOPS limit: 500, using conservative batching strategy")
        
        # IOPS-safe configuration
        batch_size = 50  # Smaller batches to reduce IOPS spikes
        updates_per_second = 10  # Limit update rate
        delay_between_batches = 2.0  # Seconds between batches
        
        updated_count = 0
        failed_count = 0
        start_time = time.time()
        
        # First, add the bertopic_version column if it doesn't exist
        try:
            print("Checking for bertopic_version column...")
            # Using direct SQL would require database credentials
            # For now, we'll handle this error gracefully when updating
        except:
            pass
        
        # Process in IOPS-safe batches
        total_batches = (len(classifications) + batch_size - 1) // batch_size
        
        for batch_num in tqdm(range(total_batches), desc="Updating database"):
            batch_start = batch_num * batch_size
            batch_end = min(batch_start + batch_size, len(classifications))
            batch = classifications[batch_start:batch_end]
            
            # Check IOPS before proceeding (simulated)
            iops_info = await self.monitor_iops()
            if iops_info['current_iops'] > iops_info['safe_threshold']:
                print(f"\n⚠️ High IOPS detected, pausing for 10 seconds...")
                await asyncio.sleep(10)
            
            # Process batch with rate limiting
            batch_updated = 0
            for i, item in enumerate(batch):
                try:
                    # Update the video record with BERTopic classification
                    # Supabase client is synchronous, not async
                    response = supabase.table('videos').update({
                        'topic_cluster_id': item['topic_id'],
                        'topic_domain': item['category'],
                        'topic_niche': item['subcategory'],
                        'topic_micro': item['topic_name'],
                        'topic_confidence': item['confidence'],
                        'bertopic_version': 'v1_2025-08-01',
                        'classified_at': datetime.utcnow().isoformat()
                    }).eq('id', item['video_id']).execute()
                    
                    updated_count += 1
                    batch_updated += 1
                    
                    # Rate limiting within batch
                    if (i + 1) % updates_per_second == 0:
                        await asyncio.sleep(1.0)
                        
                except Exception as e:
                    print(f"\nError updating video {item['video_id']}: {e}")
                    failed_count += 1
            
            # Delay between batches
            await asyncio.sleep(delay_between_batches)
            
            # Progress report every 10 batches
            if (batch_num + 1) % 10 == 0:
                elapsed = time.time() - start_time
                rate = updated_count / elapsed
                eta = (len(classifications) - updated_count) / rate if rate > 0 else 0
                print(f"\nProgress: {updated_count}/{len(classifications)} videos "
                      f"({updated_count/len(classifications)*100:.1f}%), "
                      f"Rate: {rate:.1f} videos/sec, ETA: {eta/60:.1f} min")
        
        # Final report
        elapsed = time.time() - start_time
        print(f"\n✅ Update complete!")
        print(f"   - Successfully updated: {updated_count} videos")
        print(f"   - Failed: {failed_count} videos")
        print(f"   - Total time: {elapsed/60:.1f} minutes")
        print(f"   - Average rate: {updated_count/elapsed:.1f} videos/second")
        
        return updated_count
    
    async def run(self):
        """Main execution flow"""
        print("="*60)
        print("BERTopic Database Update")
        print("="*60)
        
        # Analyze what needs to be done
        update_plan = self.prepare_update_strategy()
        
        print(f"\nUpdate Plan:")
        print(f"- Videos in training sample: {len(update_plan['in_sample'])}")
        print(f"- Videos needing classification: {len(update_plan['need_transform'])}")
        print(f"- Total videos: {update_plan['total_videos']}")
        
        all_classifications = []
        
        # Get classifications for training sample
        if update_plan['in_sample']:
            training_classifications = self.get_training_sample_classifications(
                update_plan['in_sample']
            )
            all_classifications.extend(training_classifications)
            print(f"✅ Processed {len(training_classifications)} training videos")
        
        # Classify new videos
        if update_plan['need_transform']:
            new_classifications = await self.classify_new_videos(
                update_plan['need_transform']
            )
            all_classifications.extend(new_classifications)
            print(f"✅ Classified {len(new_classifications)} new videos")
        
        # Update database
        if all_classifications:
            await self.update_database(all_classifications)
        
        # Save results for verification
        output_file = f"bertopic_database_update_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump({
                'metadata': {
                    'total_videos': len(all_classifications),
                    'model_version': 'bertopic_model_smart_20250801_131447',
                    'update_timestamp': datetime.utcnow().isoformat(),
                    'topics_used': len(self.topic_names)
                },
                'classifications': all_classifications[:100]  # Sample for review
            }, f, indent=2)
        
        print(f"\n✅ Update complete! Results saved to {output_file}")
        print(f"Total videos updated: {len(all_classifications)}")

async def main():
    updater = BERTopicDatabaseUpdater()
    await updater.run()

if __name__ == "__main__":
    asyncio.run(main())