#!/usr/bin/env python3

import os
import pandas as pd
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("=" * 60)
print("APPLYING 7-DAY SMOOTHING TO PERFORMANCE ENVELOPES")
print("=" * 60)

# Fetch all view snapshots
print("\n📊 Fetching view snapshots...")
all_snapshots = []
batch_size = 10000
offset = 0

while True:
    response = supabase.table('view_snapshots') \
        .select('days_since_published, view_count') \
        .gte('days_since_published', 0) \
        .lte('days_since_published', 3650) \
        .range(offset, offset + batch_size - 1) \
        .execute()
    
    if not response.data:
        break
    
    # Filter out records with null view_count
    valid_data = [r for r in response.data if r['view_count'] is not None]
    all_snapshots.extend(valid_data)
    print(f"  Fetched {len(all_snapshots):,} snapshots...")
    
    if len(response.data) < batch_size:
        break
    offset += batch_size

print(f"✅ Total snapshots fetched: {len(all_snapshots):,}")

# Convert to DataFrame
df = pd.DataFrame(all_snapshots)
print(f"📊 Unique days in data: {df['days_since_published'].nunique():,}")

# Calculate percentiles for each day
print("\n🔢 Calculating percentiles...")
percentiles = df.groupby('days_since_published')['view_count'].quantile([0.10, 0.25, 0.50, 0.75, 0.90]).unstack()
percentiles.columns = ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']

# Add sample count
sample_counts = df.groupby('days_since_published').size()
percentiles['sample_count'] = sample_counts

# Filter days with at least 10 samples
percentiles = percentiles[percentiles['sample_count'] >= 10]
print(f"✅ Calculated percentiles for {len(percentiles)} days")

# Apply 7-day rolling average (centered window)
print("\n🔄 Applying 7-day smoothing...")
smoothed = percentiles.copy()
for col in ['p10_views', 'p25_views', 'p50_views', 'p75_views', 'p90_views']:
    smoothed[f'{col}_smooth'] = percentiles[col].rolling(window=7, center=True, min_periods=1).mean()

# Round to integers
for col in ['p10_views_smooth', 'p25_views_smooth', 'p50_views_smooth', 'p75_views_smooth', 'p90_views_smooth']:
    smoothed[col] = smoothed[col].round().astype(int)

print("✅ Smoothing complete")

# Show sample before/after
print("\n📊 Sample comparison (Day 7):")
if 7 in smoothed.index:
    day7 = smoothed.loc[7]
    print(f"  P50 Before: {day7['p50_views']:,} views")
    print(f"  P50 After:  {day7['p50_views_smooth']:,} views")
    change = ((day7['p50_views_smooth'] - day7['p50_views']) / day7['p50_views'] * 100)
    print(f"  Change: {change:+.1f}%")

# Update database
print("\n💾 Updating performance_envelopes table...")
update_count = 0
batch_updates = []

for day in smoothed.index:
    row = smoothed.loc[day]
    update_data = {
        'day_since_published': int(day),
        'p10_views': int(row['p10_views_smooth']),
        'p25_views': int(row['p25_views_smooth']),
        'p50_views': int(row['p50_views_smooth']),
        'p75_views': int(row['p75_views_smooth']),
        'p90_views': int(row['p90_views_smooth']),
        'sample_count': int(row['sample_count'])
    }
    batch_updates.append(update_data)
    
    # Update in batches of 100
    if len(batch_updates) >= 100:
        response = supabase.table('performance_envelopes').upsert(batch_updates).execute()
        update_count += len(batch_updates)
        print(f"  Updated {update_count} / {len(smoothed)} days...", end='\r')
        batch_updates = []

# Update remaining records
if batch_updates:
    response = supabase.table('performance_envelopes').upsert(batch_updates).execute()
    update_count += len(batch_updates)

print(f"\n✅ Updated {update_count} envelope records")

# Verify the update
print("\n🔍 Verifying update...")
response = supabase.table('performance_envelopes').select('*').eq('day_since_published', 7).single().execute()
if response.data:
    print(f"  Day 7 P50: {response.data['p50_views']:,} views")

print("\n" + "=" * 60)
print("SMOOTHING APPLIED SUCCESSFULLY!")
print("Next step: Run bulk update to recalculate all video scores")
print("Command: node scripts/bulk_update_video_scores.js")
print("=" * 60)