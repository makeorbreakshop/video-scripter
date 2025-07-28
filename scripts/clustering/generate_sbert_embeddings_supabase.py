#!/usr/bin/env python3
"""
Generate SBERT embeddings for all videos in Supabase
"""
import os
import sys
import json
import numpy as np
from datetime import datetime
from sentence_transformers import SentenceTransformer
from tqdm import tqdm
import time
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv('../../.env')

# Get Supabase credentials
SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Missing Supabase credentials in .env file")
    print("   Need: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

print("SBERT Embedding Generation for BERTopic")
print("=" * 60)
print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("=" * 60)

# Initialize SBERT model
print("\n📥 Loading SBERT model...")
model_name = 'all-MiniLM-L6-v2'
try:
    model = SentenceTransformer(model_name)
    print(f"✅ Model loaded: {model_name}")
    print(f"   Embedding dimension: {model.get_sentence_embedding_dimension()}")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    sys.exit(1)

# Connect to Supabase
print("\n🔌 Connecting to Supabase...")
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ Connected to Supabase")
except Exception as e:
    print(f"❌ Supabase connection failed: {e}")
    sys.exit(1)

# Count total videos
print("\n📊 Counting videos...")
try:
    count_response = supabase.table('videos').select('id', count='exact').not_.is_('title', None).execute()
    total_videos = count_response.count
    print(f"   Total videos with titles: {total_videos:,}")
except Exception as e:
    print(f"❌ Error counting videos: {e}")
    sys.exit(1)

# Process in batches
BATCH_SIZE = 1000
SAVE_EVERY = 10000
output_dir = 'sbert_embeddings'
os.makedirs(output_dir, exist_ok=True)

print(f"\n⚙️  Configuration:")
print(f"   Batch size: {BATCH_SIZE:,}")
print(f"   Save every: {SAVE_EVERY:,}")
print(f"   Output directory: {output_dir}/")

# Process videos
print("\n🚀 Starting embedding generation...")
print("-" * 60)

all_embeddings = []
offset = 0
part_number = 1
start_time = time.time()

try:
    with tqdm(total=total_videos, desc="Processing videos") as pbar:
        while offset < total_videos:
            # Fetch batch
            response = supabase.table('videos')\
                .select('id, title, channel_name')\
                .not_.is_('title', None)\
                .order('id')\
                .range(offset, offset + BATCH_SIZE - 1)\
                .execute()
            
            batch = response.data
            if not batch:
                break
            
            # Prepare texts for embedding
            # Include channel name for better context
            texts = []
            for video in batch:
                text = video['title']
                if video.get('channel_name'):
                    text = f"{text} - {video['channel_name']}"
                texts.append(text)
            
            # Generate embeddings
            embeddings = model.encode(texts, 
                                    batch_size=32,
                                    show_progress_bar=False,
                                    convert_to_numpy=True)
            
            # Store with metadata
            for i, video in enumerate(batch):
                all_embeddings.append({
                    'id': video['id'],
                    'title': video['title'],
                    'channel_name': video.get('channel_name', ''),
                    'embedding': embeddings[i].tolist()
                })
            
            # Save periodically
            if len(all_embeddings) >= SAVE_EVERY:
                filename = os.path.join(output_dir, f'sbert_embeddings_part_{part_number:03d}.json')
                with open(filename, 'w') as f:
                    json.dump({
                        'model': model_name,
                        'dimension': model.get_sentence_embedding_dimension(),
                        'count': len(all_embeddings),
                        'embeddings': all_embeddings
                    }, f)
                
                print(f"\n💾 Saved part {part_number}: {filename} ({len(all_embeddings):,} embeddings)")
                all_embeddings = []
                part_number += 1
            
            offset += len(batch)
            pbar.update(len(batch))
            
            # Show progress stats
            if offset % 10000 == 0:
                elapsed = time.time() - start_time
                rate = offset / elapsed
                remaining = (total_videos - offset) / rate
                print(f"\n⏱️  Progress: {offset:,}/{total_videos:,} ({offset/total_videos*100:.1f}%)")
                print(f"   Rate: {rate:.0f} videos/second")
                print(f"   ETA: {remaining/60:.1f} minutes")

    # Save final batch
    if all_embeddings:
        filename = os.path.join(output_dir, f'sbert_embeddings_part_{part_number:03d}.json')
        with open(filename, 'w') as f:
            json.dump({
                'model': model_name,
                'dimension': model.get_sentence_embedding_dimension(),
                'count': len(all_embeddings),
                'embeddings': all_embeddings
            }, f)
        print(f"\n💾 Saved final part {part_number}: {filename} ({len(all_embeddings):,} embeddings)")

except Exception as e:
    print(f"\n❌ Error during processing: {e}")
    import traceback
    traceback.print_exc()

# Summary
elapsed_time = time.time() - start_time
print("\n" + "=" * 60)
print("✅ EMBEDDING GENERATION COMPLETE!")
print("=" * 60)
print(f"Total time: {elapsed_time/60:.1f} minutes")
print(f"Videos processed: {offset:,}")
print(f"Parts created: {part_number}")
print(f"Output directory: {output_dir}/")
print(f"\nNext step: Run BERTopic clustering on these embeddings")
print("Command: python3 run_bertopic_clustering.py")