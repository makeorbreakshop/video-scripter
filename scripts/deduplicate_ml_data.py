#!/usr/bin/env python3

"""
Deduplicate ML training data batches
Removes duplicates based on video_id + days_since_published
"""

import json
import glob
from collections import defaultdict

def deduplicate_batches():
    print("🔍 Loading and deduplicating ML training batches...")
    
    # Load all batch files
    all_records = []
    batch_files = sorted(glob.glob('data/ml_training_batch_*.json'))
    
    print(f"📂 Found {len(batch_files)} batch files")
    
    for batch_file in batch_files:
        print(f"📖 Loading {batch_file}...")
        with open(batch_file, 'r') as f:
            batch_data = json.load(f)
            all_records.extend(batch_data)
    
    print(f"📊 Total records loaded: {len(all_records):,}")
    
    # Deduplicate using video_id + days_since_published as unique key
    seen = set()
    unique_records = []
    duplicates = 0
    
    for record in all_records:
        # Create unique key
        unique_key = (record['video_id'], record['days_since_published'])
        
        if unique_key not in seen:
            seen.add(unique_key)
            unique_records.append(record)
        else:
            duplicates += 1
    
    print(f"✅ Unique records: {len(unique_records):,}")
    print(f"🗑️  Duplicates removed: {duplicates:,}")
    print(f"📈 Deduplication rate: {(duplicates/len(all_records)*100):.1f}%")
    
    # Sort by video_id and days for consistent ordering
    unique_records.sort(key=lambda x: (x['video_id'], x['days_since_published']))
    
    # Save deduplicated data
    print(f"\n💾 Saving deduplicated data...")
    
    # Save as single file
    with open('data/ml_training_dataset_clean.json', 'w') as f:
        json.dump(unique_records, f, indent=2)
    
    # Also save in batches for easier loading
    batch_size = 25000
    total_batches = (len(unique_records) + batch_size - 1) // batch_size
    
    for i in range(total_batches):
        start_idx = i * batch_size
        end_idx = min(start_idx + batch_size, len(unique_records))
        batch = unique_records[start_idx:end_idx]
        
        batch_file = f'data/ml_training_clean_batch_{i+1}.json'
        with open(batch_file, 'w') as f:
            json.dump(batch, f, indent=2)
        
        print(f"✅ Saved clean batch {i+1}/{total_batches}: {len(batch):,} records → {batch_file}")
    
    # Save metadata
    metadata = {
        "deduplication_date": "2025-08-06",
        "original_records": len(all_records),
        "unique_records": len(unique_records),
        "duplicates_removed": duplicates,
        "deduplication_rate": round(duplicates/len(all_records)*100, 1),
        "clean_batches": total_batches,
        "batch_size": batch_size
    }
    
    with open('data/ml_dataset_clean_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"✅ Saved metadata to data/ml_dataset_clean_metadata.json")
    
    print("\n" + "="*60)
    print("🎉 Deduplication complete!")
    print(f"📊 Original: {len(all_records):,} records")
    print(f"📈 Clean: {len(unique_records):,} records")
    print(f"🗑️  Removed: {duplicates:,} duplicates ({duplicates/len(all_records)*100:.1f}%)")
    print(f"📁 Clean files: ml_training_clean_batch_1.json to ml_training_clean_batch_{total_batches}.json")
    print("="*60)

if __name__ == "__main__":
    deduplicate_batches()