#!/usr/bin/env python3
"""
Generate SBERT embeddings for all videos in the database
"""
import os
import sys
import json
import numpy as np
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from sentence_transformers import SentenceTransformer
from tqdm import tqdm
import time
from dotenv import load_dotenv
from urllib.parse import urlparse

# Load environment variables
load_dotenv('../../.env')

# Parse database URL
DATABASE_URL = os.getenv('DATABASE_URL')
if not DATABASE_URL:
    print("❌ DATABASE_URL not found in environment")
    sys.exit(1)

# Parse the URL
url = urlparse(DATABASE_URL)
db_config = {
    'host': url.hostname,
    'port': url.port or 5432,
    'database': url.path[1:],
    'user': url.username,
    'password': url.password
}

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

# Connect to database
print("\n🔌 Connecting to database...")
try:
    conn = psycopg2.connect(**db_config)
    cur = conn.cursor(cursor_factory=RealDictCursor)
    print("✅ Connected to database")
except Exception as e:
    print(f"❌ Database connection failed: {e}")
    sys.exit(1)

# Count total videos
print("\n📊 Counting videos...")
cur.execute("SELECT COUNT(*) as count FROM videos WHERE title IS NOT NULL")
total_videos = cur.fetchone()['count']
print(f"   Total videos with titles: {total_videos:,}")

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
            cur.execute("""
                SELECT id, title, channel_name
                FROM videos 
                WHERE title IS NOT NULL
                ORDER BY id
                LIMIT %s OFFSET %s
            """, (BATCH_SIZE, offset))
            
            batch = cur.fetchall()
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
            
            offset += BATCH_SIZE
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
finally:
    cur.close()
    conn.close()

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