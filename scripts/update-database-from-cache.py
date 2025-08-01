#!/usr/bin/env python3
"""
Update Supabase database from cached BERTopic classifications
This script loads pre-computed classifications and updates the database
"""

import os
import json
import pickle
from datetime import datetime
from supabase import create_client, Client
from dotenv import load_dotenv
import time
from tqdm import tqdm

load_dotenv()

# Initialize Supabase client
supabase: Client = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_ROLE_KEY')
)

# Checkpoint file to track progress
CHECKPOINT_FILE = 'bertopic_update_checkpoint.json'

def load_checkpoint():
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
        'start_time': datetime.utcnow().isoformat()
    }

def save_checkpoint(checkpoint):
    """Save current progress"""
    # Convert set to list for JSON serialization
    checkpoint_data = checkpoint.copy()
    checkpoint_data['processed_ids'] = list(checkpoint['processed_ids'])
    
    with open(CHECKPOINT_FILE, 'w') as f:
        json.dump(checkpoint_data, f)

def main():
    print("="*60)
    print("BERTopic Database Update from Cache")
    print("="*60)
    
    # Load classifications from cache
    classifications_file = 'bertopic_classifications_cache.pkl'
    if not os.path.exists(classifications_file):
        print(f"❌ Cache file not found: {classifications_file}")
        print("Please run the classification script first.")
        return
    
    print(f"\n📂 Loading cached classifications...")
    with open(classifications_file, 'rb') as f:
        all_classifications = pickle.load(f)
    print(f"✅ Loaded {len(all_classifications)} classifications")
    
    # Load checkpoint
    checkpoint = load_checkpoint()
    
    # Filter out already processed videos
    classifications_to_process = [
        c for c in all_classifications 
        if c['video_id'] not in checkpoint['processed_ids']
    ]
    
    print(f"\n📊 Update Plan:")
    print(f"   - Total classifications: {len(all_classifications)}")
    print(f"   - Already processed: {checkpoint['processed_count']}")
    print(f"   - Remaining to update: {len(classifications_to_process)}")
    
    if not classifications_to_process:
        print("\n✅ All videos already processed!")
        return
    
    # Update database
    print("\n📝 Updating database...")
    updated = 0
    failed = 0
    batch_size = 100  # Increased batch size for faster processing
    
    start_time = time.time()
    last_checkpoint_save = time.time()
    
    with tqdm(total=len(classifications_to_process), desc="Updating database") as pbar:
        for i in range(0, len(classifications_to_process), batch_size):
            batch = classifications_to_process[i:i+batch_size]
            
            # Process items in the batch with parallel-like speed
            for item in batch:
                try:
                    # Use UPDATE to avoid null channel_id issues
                    response = supabase.table('videos').update({
                        'topic_cluster_id': item['topic_id'],
                        'topic_domain': item.get('category', 'Unknown'),
                        'topic_niche': item.get('subcategory', 'Unknown'),
                        'topic_micro': item.get('topic_name', f'Topic {item["topic_id"]}'),
                        'topic_confidence': item.get('confidence', 0.0),
                        'bertopic_version': 'v1_2025-08-01',
                        'classified_at': datetime.utcnow().isoformat()
                    }).eq('id', item['video_id']).execute()
                    
                    updated += 1
                    checkpoint['processed_ids'].add(item['video_id'])
                    checkpoint['processed_count'] += 1
                    
                except Exception as e:
                    print(f"\nError updating {item['video_id']}: {e}")
                    failed += 1
            
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
                save_checkpoint(checkpoint)
                last_checkpoint_save = time.time()
    
    # Final checkpoint save
    save_checkpoint(checkpoint)
    
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

if __name__ == "__main__":
    main()