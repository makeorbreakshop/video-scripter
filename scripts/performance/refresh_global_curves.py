#!/usr/bin/env python3
"""
Refresh global performance curves with all new data
One-time full update, then we'll move to weekly/incremental
"""

import os
import numpy as np
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime
from scipy.ndimage import gaussian_filter1d

# Load environment variables
load_dotenv()

# Initialize Supabase client
url = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(url, key)

print("🔄 Refreshing Global Performance Curves")
print("=" * 60)

# Check current state
current_stats = supabase.table('performance_envelopes')\
    .select('updated_at')\
    .order('updated_at', desc=True)\
    .limit(1)\
    .execute()

print(f"Last update: {current_stats.data[0]['updated_at'] if current_stats.data else 'Never'}")

# Get total snapshot count
count_result = supabase.table('view_snapshots')\
    .select('*', count='exact', head=True)\
    .execute()

total_snapshots = count_result.count
print(f"Total snapshots to process: {total_snapshots:,}")

# Process in daily batches
print("\n📊 Calculating new percentiles...")
daily_stats = {}
processed = 0

for day in range(0, 3651):  # 10 years
    # Get all view counts for this day (excluding Shorts)
    batch_data = []
    offset = 0
    batch_size = 1000
    
    while True:
        batch = supabase.table('view_snapshots')\
            .select('view_count, videos!inner(duration)')\
            .eq('days_since_published', day)\
            .range(offset, offset + batch_size - 1)\
            .execute()
        
        if not batch.data:
            break
            
        # Filter for non-Shorts
        for row in batch.data:
            if row.get('videos') and row['videos'].get('duration'):
                dur = row['videos']['duration']
                # Quick check for >121 seconds
                is_long = False
                if 'H' in dur or ('M' in dur and 'PT' in dur):
                    is_long = True
                elif 'PT' in dur and 'S' in dur and not 'M' in dur:
                    try:
                        secs = int(dur.split('S')[0].split('PT')[-1])
                        if secs > 121:
                            is_long = True
                    except:
                        pass
                
                if is_long and row['view_count'] is not None:
                    batch_data.append(row['view_count'])
        
        offset += batch_size
        if len(batch.data) < batch_size:
            break
    
    processed += len(batch_data)
    
    if len(batch_data) >= 10:  # Minimum samples for percentiles
        views = np.array(batch_data)
        daily_stats[day] = {
            'p10': int(np.percentile(views, 10)),
            'p25': int(np.percentile(views, 25)),
            'p50': int(np.percentile(views, 50)),
            'p75': int(np.percentile(views, 75)),
            'p90': int(np.percentile(views, 90)),
            'p95': int(np.percentile(views, 95)),
            'count': len(batch_data)
        }
    
    # Progress update
    if day % 100 == 0:
        print(f"   Day {day}: {processed:,} snapshots processed")

print(f"\nTotal non-Short snapshots processed: {processed:,}")
print(f"Days with sufficient data: {len(daily_stats)}")

# Apply smoothing
print("\n📈 Applying smoothing to curves...")
days = sorted(daily_stats.keys())
metrics = ['p10', 'p25', 'p50', 'p75', 'p90', 'p95']

for metric in metrics:
    values = [daily_stats[d][metric] for d in days]
    
    # Graduated smoothing
    smooth_values = np.array(values, dtype=float)
    
    # Light smoothing for early days
    if len(smooth_values) > 8:
        smooth_values[:8] = gaussian_filter1d(smooth_values[:8], sigma=0.5)
    if len(smooth_values) > 31:
        smooth_values[8:31] = gaussian_filter1d(smooth_values[8:31], sigma=1.0)
    if len(smooth_values) > 91:
        smooth_values[31:91] = gaussian_filter1d(smooth_values[31:91], sigma=2.0)
    if len(smooth_values) > 365:
        smooth_values[91:365] = gaussian_filter1d(smooth_values[91:365], sigma=3.0)
    if len(smooth_values) > 365:
        smooth_values[365:] = gaussian_filter1d(smooth_values[365:], sigma=5.0)
    
    # Update values
    for i, day in enumerate(days):
        daily_stats[day][metric] = int(smooth_values[i])

# Update database
print("\n💾 Updating performance_envelopes table...")
updates = []
current_time = datetime.now().isoformat()

for day in range(0, 3651):
    if day in daily_stats:
        updates.append({
            'day_since_published': day,
            'p10_views': daily_stats[day]['p10'],
            'p25_views': daily_stats[day]['p25'],
            'p50_views': daily_stats[day]['p50'],
            'p75_views': daily_stats[day]['p75'],
            'p90_views': daily_stats[day]['p90'],
            'p95_views': daily_stats[day]['p95'],
            'sample_count': daily_stats[day]['count'],
            'updated_at': current_time
        })

# Upsert in batches
batch_size = 100
for i in range(0, len(updates), batch_size):
    batch = updates[i:i + batch_size]
    supabase.table('performance_envelopes')\
        .upsert(batch)\
        .execute()
    print(f"   Updated days {i} to {min(i + batch_size, len(updates))}")

# Summary
print("\n✅ Update Complete!")
print(f"   Days updated: {len(updates)}")
print(f"   Total samples: {processed:,}")
print(f"   New median growth curve:")
print(f"     Day 1:    {daily_stats.get(1, {}).get('p50', 'N/A'):,} views")
print(f"     Day 7:    {daily_stats.get(7, {}).get('p50', 'N/A'):,} views")
print(f"     Day 30:   {daily_stats.get(30, {}).get('p50', 'N/A'):,} views")
print(f"     Day 365:  {daily_stats.get(365, {}).get('p50', 'N/A'):,} views")
print(f"     Day 1825: {daily_stats.get(1825, {}).get('p50', 'N/A'):,} views")

# Compare to old values
old_curves = supabase.table('performance_envelopes')\
    .select('day_since_published, p50_views')\
    .in_('day_since_published', [1, 7, 30, 365, 1825])\
    .execute()

if old_curves.data:
    print("\n   Changes from previous curves:")
    for old in old_curves.data:
        day = old['day_since_published']
        if day in daily_stats:
            old_val = old['p50_views']
            new_val = daily_stats[day]['p50']
            change = ((new_val - old_val) / old_val) * 100 if old_val > 0 else 0
            print(f"     Day {day}: {change:+.1f}% change")