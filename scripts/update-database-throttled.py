#!/usr/bin/env python3
"""
Throttled update of Supabase database from cached BERTopic classifications
Respects 500 IOPS limit with dynamic throttling
"""

import os
import json
import pickle
import asyncio
import aiohttp
from datetime import datetime
from dotenv import load_dotenv
import time
from tqdm.asyncio import tqdm

load_dotenv()

# Supabase configuration
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

# Checkpoint file to track progress
CHECKPOINT_FILE = 'bertopic_update_checkpoint.json'

# Performance settings - REDUCED for IOPS safety
MAX_CONCURRENT = 10  # Reduced from 50 to 10
BATCH_SIZE = 50      # Smaller batches
DELAY_BETWEEN_BATCHES = 0.2  # 200ms delay between batches

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

async def update_video(session, item, semaphore):
    """Update a single video with rate limiting"""
    async with semaphore:
        url = f"{SUPABASE_URL}/rest/v1/videos?id=eq.{item['video_id']}"
        
        headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        }
        
        data = {
            'topic_cluster_id': item['topic_id'],
            'topic_domain': item.get('category', 'Unknown'),
            'topic_niche': item.get('subcategory', 'Unknown'),
            'topic_micro': item.get('topic_name', f'Topic {item["topic_id"]}'),
            'topic_confidence': item.get('confidence', 0.0),
            'bertopic_version': 'v1_2025-08-01',
            'classified_at': datetime.utcnow().isoformat()
        }
        
        try:
            async with session.patch(url, json=data, headers=headers) as response:
                if response.status == 200 or response.status == 204:
                    return True, item['video_id'], None
                else:
                    error_text = await response.text()
                    return False, item['video_id'], f"Status {response.status}: {error_text}"
        except Exception as e:
            return False, item['video_id'], str(e)

async def process_batch(session, batch, checkpoint, pbar, semaphore):
    """Process a batch of videos concurrently"""
    tasks = [update_video(session, item, semaphore) for item in batch]
    results = await asyncio.gather(*tasks)
    
    updated = 0
    failed = 0
    
    for success, video_id, error in results:
        if success:
            checkpoint['processed_ids'].add(video_id)
            checkpoint['processed_count'] += 1
            updated += 1
        else:
            if error and "duplicate key value" not in error:
                print(f"\nError updating {video_id}: {error}")
            failed += 1
    
    pbar.update(len(batch))
    return updated, failed

async def main():
    print("="*60)
    print("BERTopic Database Update - IOPS-Safe Version")
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
    print(f"\n⚡ Performance Settings (IOPS-Safe):")
    print(f"   - Concurrent connections: {MAX_CONCURRENT}")
    print(f"   - Batch size: {BATCH_SIZE}")
    print(f"   - Delay between batches: {DELAY_BETWEEN_BATCHES}s")
    print(f"   - Target IOPS: ~400 (80% of limit)")
    
    if not classifications_to_process:
        print("\n✅ All videos already processed!")
        return
    
    # Create semaphore for rate limiting
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    
    # Update database
    print("\n📝 Updating database...")
    total_updated = 0
    total_failed = 0
    
    start_time = time.time()
    last_checkpoint_save = time.time()
    
    # Create aiohttp session with connection pooling
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT)
    timeout = aiohttp.ClientTimeout(total=30)
    
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        pbar = tqdm(total=len(classifications_to_process), desc="Updating database")
        
        for i in range(0, len(classifications_to_process), BATCH_SIZE):
            batch = classifications_to_process[i:i+BATCH_SIZE]
            
            # Process batch
            updated, failed = await process_batch(session, batch, checkpoint, pbar, semaphore)
            total_updated += updated
            total_failed += failed
            
            # Update progress info
            if total_updated > 0:
                elapsed = time.time() - start_time
                rate = total_updated / elapsed
                remaining = len(classifications_to_process) - total_updated - total_failed
                eta = remaining / rate if rate > 0 else 0
                
                # Calculate approximate IOPS
                approx_iops = rate * 2  # Each update is ~2 IOPS (read + write)
                
                pbar.set_postfix({
                    'rate': f'{rate:.1f}/s',
                    'eta': f'{eta/60:.0f}m',
                    'IOPS': f'~{approx_iops:.0f}',
                    'updated': total_updated,
                    'failed': total_failed
                })
            
            # Save checkpoint every 30 seconds
            if time.time() - last_checkpoint_save > 30:
                save_checkpoint(checkpoint)
                last_checkpoint_save = time.time()
            
            # Delay between batches to control IOPS
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)
        
        pbar.close()
    
    # Final checkpoint save
    save_checkpoint(checkpoint)
    
    # Final report
    elapsed = time.time() - start_time
    print(f"\n✅ Update complete!")
    print(f"   - Successfully updated: {total_updated} videos")
    print(f"   - Failed: {total_failed} videos")
    print(f"   - Total time: {elapsed/60:.1f} minutes")
    print(f"   - Average rate: {total_updated/elapsed:.1f} videos/second")
    print(f"   - Average IOPS: ~{(total_updated/elapsed)*2:.0f}")
    
    # Clean up checkpoint file
    if total_failed == 0 and os.path.exists(CHECKPOINT_FILE):
        os.remove(CHECKPOINT_FILE)
        print(f"\n🧹 Checkpoint file removed")

if __name__ == "__main__":
    asyncio.run(main())